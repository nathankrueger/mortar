import {
  DT,
  GRAVITY,
  MAX_PROJECTILE_SECONDS,
  MAX_RESOLUTION_SECONDS,
  OOB_MARGIN_X,
  OOB_MARGIN_Y_BOTTOM,
  TANK_H,
  TANK_HIT_RADIUS,
  TICK_HZ,
} from '../constants';
import { chance, mulberry32, randInt, randRange, weightedIndex, type Rng } from '../rng';
import { weaponSpec, type BounceSpec, type SplitSpec } from '../weapons';
import { muzzleVelocity } from './ballistics';
import { applyExplosion, type DamageTally } from './explosions';
import { settleTanks } from './tanks';
import type {
  ProjectileKind,
  ShotContext,
  ShotOutcome,
  ShotParams,
  SimEvent,
  SimTank,
} from './types';

const PATH_STRIDE = 4; // sample every 4 ticks = 30 Hz
const PATH_CHUNK = 40; // flush after this many samples
const SUBSTEP_WU = 2; // max movement per collision sample
const MUZZLE_LEN = 30;
const SHOOTER_GRACE_S = 0.35; // no self-collision right off the barrel
const REST_SPEED = 60;
const REST_ARM_S = 0.4;
const MAX_TICKS = MAX_RESOLUTION_SECONDS * TICK_HZ;

interface LiveProjectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  bornTick: number;
  // Detonation payload.
  blastR: number;
  dmg: number;
  tier: number;
  // Behavior.
  split: SplitSpec | null; // pending apex split
  childBounce: BounceSpec | null; // bounce behavior handed to split children
  bounce: BounceSpec | null;
  bounceLimit: number;
  bounces: number;
  mnwWeights: readonly number[] | null;
  airstrike: { count: number; spread: number; blastR: number; dmg: number } | null;
  digRemaining: number;
  isDirt: boolean;
  isRoller: boolean;
  rolling: boolean;
  rollDir: number;
  restTime: number;
  // Playback path sampling.
  pathStart: number;
  xs: number[];
  ys: number[];
}

/**
 * Fully resolve one shot: integrate every projectile at 120 Hz against the
 * terrain mask, apply splits/bounces/explosions/falls, and return the ordered
 * event log. Mutates ctx.mask and ctx.tanks. Deterministic in (ctx, params).
 */
export function resolveShot(ctx: ShotContext, params: ShotParams): ShotOutcome {
  const rng = mulberry32(ctx.seed);
  const events: SimEvent[] = [];
  const tally: DamageTally = { damageToOpponent: 0, directHits: 0 };
  const shooter = ctx.tanks.find((t) => t.seat === params.seat);
  if (!shooter) throw new Error(`no tank in seat ${params.seat}`);

  let nextId = 1;
  let tick = 0;
  const live: LiveProjectile[] = [];

  type SpawnPayload = Pick<
    LiveProjectile,
    'blastR' | 'dmg' | 'tier' | 'split' | 'childBounce' | 'bounce' | 'mnwWeights'
  > &
    Partial<Pick<LiveProjectile, 'airstrike' | 'digRemaining' | 'isDirt' | 'isRoller'>>;

  const spawn = (
    kind: ProjectileKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    payload: SpawnPayload,
  ): LiveProjectile => {
    const p: LiveProjectile = {
      id: nextId++,
      kind,
      x,
      y,
      vx,
      vy,
      age: 0,
      bornTick: tick,
      airstrike: null,
      digRemaining: 0,
      isDirt: false,
      isRoller: false,
      ...payload,
      rolling: false,
      rollDir: 1,
      bounceLimit: payload.bounce ? randInt(rng, payload.bounce.min, payload.bounce.max) : 0,
      bounces: 0,
      restTime: 0,
      pathStart: tick,
      xs: [x],
      ys: [y],
    };
    live.push(p);
    events.push({
      t: 'spawn',
      id: p.id,
      kind,
      weapon: params.weapon,
      x,
      y,
      vx,
      vy,
      tick,
    });
    return p;
  };

  const flushPath = (p: LiveProjectile): void => {
    if (p.xs.length > 1) {
      events.push({
        t: 'path',
        id: p.id,
        startTick: p.pathStart,
        stride: PATH_STRIDE,
        xs: p.xs,
        ys: p.ys,
      });
    }
    p.xs = [];
    p.ys = [];
  };

  const remove = (p: LiveProjectile): void => {
    flushPath(p);
    const i = live.indexOf(p);
    if (i >= 0) live.splice(i, 1);
  };

  const detonate = (p: LiveProjectile, x: number, y: number, directTank: SimTank | null): void => {
    remove(p);
    applyExplosion(ctx, events, {
      id: p.id,
      x,
      y,
      blastR: p.blastR,
      dmg: p.dmg,
      tier: p.tier,
      tick,
      directTank,
      shooterSeat: params.seat,
      tally,
    });
    settleTanks(ctx, events, tick);
    if (p.airstrike) callAirstrike(p, x);
  };

  /** Dirt bomb: no blast — deposit a hill and settle whoever it lands on. */
  const doDirt = (p: LiveProjectile, x: number, y: number): void => {
    remove(p);
    events.push({ t: 'explode', id: p.id, x, y, r: 26, tier: 0, tick });
    ctx.mask.addMound(x, p.blastR);
    events.push({ t: 'carve', circles: [{ x, y, r: p.blastR, add: true }], tick });
    settleTanks(ctx, events, tick);
  };

  /** Airstrike: shells rain from the sky around the marked column. */
  const callAirstrike = (p: LiveProjectile, x: number): void => {
    const a = p.airstrike!;
    for (let i = 0; i < a.count; i++) {
      const off =
        (i - (a.count - 1) / 2) * ((a.spread * 2) / a.count) + randRange(rng, -25, 25);
      spawn('warhead', x + off, -60, randRange(rng, -15, 15), 340, {
        blastR: a.blastR,
        dmg: a.dmg,
        tier: 0,
        split: null,
        childBounce: null,
        bounce: null,
        mnwWeights: null,
      });
    }
  };

  const ROLL_SPEED = 240; // wu/s along the surface

  const startRolling = (p: LiveProjectile): void => {
    const sr = ctx.mask.surfaceYAt(Math.round(p.x + 4));
    const sl = ctx.mask.surfaceYAt(Math.round(p.x - 4));
    p.rollDir = sr > sl ? 1 : sr < sl ? -1 : Math.sign(p.vx) || 1;
    p.y = ctx.mask.surfaceYAt(Math.round(p.x)) - 2;
    p.rolling = true;
  };

  /** Roller: hug the surface downhill until a wall/valley or a tank. */
  const rollStep = (p: LiveProjectile): void => {
    p.age += DT;
    if (p.age > MAX_PROJECTILE_SECONDS) {
      detonate(p, p.x, p.y, null);
      return;
    }
    const total = ROLL_SPEED * DT;
    const steps = Math.max(1, Math.ceil(total / 2));
    for (let s = 0; s < steps; s++) {
      const nx = p.x + (p.rollDir * total) / steps;
      if (nx < -OOB_MARGIN_X || nx > ctx.mask.w + OOB_MARGIN_X) {
        fizzle(p, p.x, p.y);
        return;
      }
      const surf = ctx.mask.surfaceYAt(Math.round(nx));
      if (surf - 2 < p.y) {
        // Climbing. A pebble is fine; sustained net climb means the valley
        // floor is behind us — detonate. (restTime doubles as the climb sum.)
        // Flat ground keeps the sum: integer surfaces turn gentle slopes into
        // stairs, and resetting on each tread would never trip the detector.
        p.restTime += p.y - (surf - 2);
        if (p.restTime > 6) {
          detonate(p, p.x, p.y, null);
          return;
        }
      } else if (surf - 2 > p.y) {
        p.restTime = 0; // genuinely rolling downhill again
      }
      p.x = nx;
      p.y = surf - 2;
      const hitTank = findTankHit(ctx.tanks, p, params.seat);
      if (hitTank) {
        detonate(p, p.x, p.y, hitTank);
        return;
      }
    }
    if ((tick - p.pathStart) % PATH_STRIDE === 0) {
      p.xs.push(p.x);
      p.ys.push(p.y);
    }
  };

  const fizzle = (p: LiveProjectile, x: number, y: number): void => {
    remove(p);
    events.push({ t: 'fizzle', id: p.id, x, y, tick });
  };

  /** MNW family: a mirv whose warhead count is a gamble. */
  const doMnwSplit = (p: LiveProjectile): void => {
    const split = p.split!;
    const k = 1 + weightedIndex(rng, p.mnwWeights!);
    events.push({ t: 'split', id: p.id, tick });
    remove(p);
    for (let i = 0; i < k; i++) {
      const offset = (i - (k - 1) / 2) * split.spreadVx;
      const jitter = randRange(rng, -split.jitterVx, split.jitterVx);
      spawn('nukelet', p.x, p.y, p.vx + offset + jitter, p.vy, {
        blastR: p.blastR,
        dmg: p.dmg,
        tier: p.tier,
        split: null,
        childBounce: null,
        bounce: null,
        mnwWeights: null,
      });
    }
  };

  const doSplit = (p: LiveProjectile): void => {
    const split = p.split!;
    events.push({ t: 'split', id: p.id, tick });
    remove(p);
    for (let i = 0; i < split.count; i++) {
      const offset = (i - (split.count - 1) / 2) * split.spreadVx;
      const jitter = randRange(rng, -split.jitterVx, split.jitterVx);
      spawn('warhead', p.x, p.y, p.vx + offset + jitter, p.vy, {
        blastR: p.blastR,
        dmg: p.dmg,
        tier: p.tier,
        split: null,
        childBounce: null,
        bounce: p.childBounce,
        mnwWeights: null,
      });
    }
  };

  /**
   * A hop: detonate at the landing point, then leap up and away in a random
   * direction to land (and blast) somewhere else.
   */
  const doBounce = (p: LiveProjectile, hx: number, hy: number): void => {
    const b = p.bounce!;
    // Hop explosion under its own synthetic id — the bomb itself lives on.
    applyExplosion(ctx, events, {
      id: nextId++,
      x: hx,
      y: hy,
      blastR: b.hopBlastR,
      dmg: b.hopDmg,
      tier: 0,
      tick,
      directTank: null,
      shooterSeat: params.seat,
      tally,
    });
    settleTanks(ctx, events, tick);

    // The blast just carved the ground away — launch out of the fresh crater.
    p.x = hx;
    p.y = hy - 4;
    p.vx = p.vx * b.restitution + randRange(rng, -b.nudge, b.nudge);
    p.vy = -randRange(rng, 280, 400);
    p.bounces++;
    events.push({ t: 'bounce', id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, n: p.bounces, tick });
  };

  /** Terrain contact dispatch. Returns true if the projectile is gone. */
  const onTerrainContact = (p: LiveProjectile, hx: number, hy: number): boolean => {
    if (p.bounce && p.bounces < p.bounceLimit) {
      doBounce(p, hx, hy);
      return false;
    }
    if (p.bounce && p.bounce.dudChance > 0 && chance(rng, p.bounce.dudChance)) {
      fizzle(p, hx, hy);
      return true;
    }
    detonate(p, hx, hy, null);
    return true;
  };

  // ---- Fire! -------------------------------------------------------------
  const spec = weaponSpec(params.weapon);
  const { vx, vy } = muzzleVelocity(params.angleDeg, params.power, ctx.mask.w);
  const dirLen = Math.sqrt(vx * vx + vy * vy) || 1;
  const cx = shooter.x + (vx / dirLen) * MUZZLE_LEN;
  const cy = shooter.y - TANK_H / 2 + (vy / dirLen) * MUZZLE_LEN;
  const splitting =
    spec.behavior === 'mirv' || spec.behavior === 'mirvBounce' || spec.behavior === 'mnw';
  spawn(params.weapon, cx, cy, vx, vy, {
    // An MNW hitting before apex detonates as a single warhead of its class.
    blastR: spec.blastR,
    dmg: spec.dmg,
    tier: spec.tier,
    split: splitting ? spec.split! : null,
    childBounce: spec.behavior === 'mirvBounce' ? spec.bounce! : null,
    bounce: spec.behavior === 'bounce' ? spec.bounce! : null,
    mnwWeights: spec.behavior === 'mnw' ? spec.mnwWeights! : null,
    airstrike: spec.behavior === 'airstrike' ? spec.airstrike! : null,
    digRemaining: spec.behavior === 'digger' ? spec.dig!.depth : 0,
    isDirt: spec.behavior === 'dirt',
    isRoller: spec.behavior === 'roller',
  });

  // ---- Main loop ---------------------------------------------------------
  while (live.length > 0 && tick < MAX_TICKS) {
    tick++;
    for (const p of [...live]) {
      if (!live.includes(p)) continue;
      if (p.rolling) {
        rollStep(p);
        continue;
      }
      const prevVy = p.vy;
      p.vx += ctx.wind * DT;
      p.vy += GRAVITY * DT;
      p.age += DT;

      // Apex split: vertical velocity flips downward.
      if (p.split && p.age > 0.25 && prevVy < 0 && p.vy >= 0) {
        if (p.mnwWeights) doMnwSplit(p);
        else doSplit(p);
        continue;
      }

      // Integrate with sub-sampling so thin walls can't be tunneled through.
      const stepX = p.vx * DT;
      const stepY = p.vy * DT;
      const dist = Math.sqrt(stepX * stepX + stepY * stepY);
      const steps = Math.max(1, Math.ceil(dist / SUBSTEP_WU));
      let goneOrBounced = false;
      for (let s = 0; s < steps; s++) {
        p.x += stepX / steps;
        p.y += stepY / steps;

        const hitTank = findTankHit(ctx.tanks, p, params.seat);
        if (hitTank) {
          if (p.isDirt) doDirt(p, p.x, p.y);
          else detonate(p, p.x, p.y, hitTank);
          goneOrBounced = true;
          break;
        }
        if (ctx.mask.solidAt(p.x, p.y)) {
          if (p.digRemaining > 0) {
            // Tunneling: burn depth budget instead of detonating.
            p.digRemaining -= dist / steps;
            if (p.digRemaining <= 0) {
              detonate(p, p.x, p.y, null);
              goneOrBounced = true;
              break;
            }
            continue;
          }
          if (p.isDirt) {
            doDirt(p, p.x, p.y);
            goneOrBounced = true;
            break;
          }
          if (p.isRoller && !p.rolling) {
            startRolling(p); // hugs the surface from the next tick on
            goneOrBounced = true;
            break;
          }
          goneOrBounced = onTerrainContact(p, p.x, p.y) || true;
          break;
        }
      }
      if (goneOrBounced || !live.includes(p)) continue;

      // Out of bounds / lifetime.
      if (
        p.x < -OOB_MARGIN_X ||
        p.x > ctx.mask.w + OOB_MARGIN_X ||
        p.y > ctx.mask.h + OOB_MARGIN_Y_BOTTOM ||
        p.age > MAX_PROJECTILE_SECONDS
      ) {
        fizzle(p, p.x, p.y);
        continue;
      }

      // A bouncer that has run out of pep resolves early.
      if (p.bounce) {
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed < REST_SPEED && p.bounces > 0) {
          p.restTime += DT;
          if (p.restTime > REST_ARM_S) {
            p.bounces = p.bounceLimit; // force final-contact rules
            if (p.bounce.dudChance > 0 && chance(rng, p.bounce.dudChance)) {
              fizzle(p, p.x, p.y);
            } else {
              detonate(p, p.x, p.y, null);
            }
            continue;
          }
        } else {
          p.restTime = 0;
        }
      }

      if ((tick - p.pathStart) % PATH_STRIDE === 0) {
        p.xs.push(p.x);
        p.ys.push(p.y);
        if (p.xs.length >= PATH_CHUNK) {
          flushPath(p);
          p.pathStart = tick;
          p.xs = [p.x];
          p.ys = [p.y];
        }
      }
    }
  }

  // Watchdog: anything still alive at the cap fizzles in place.
  for (const p of [...live]) fizzle(p, p.x, p.y);

  return { events, damageToOpponent: tally.damageToOpponent, directHits: tally.directHits, ticks: tick };
}

function findTankHit(tanks: SimTank[], p: LiveProjectile, shooterSeat: number): SimTank | null {
  for (const tank of tanks) {
    if (!tank.alive) continue;
    if (tank.seat === shooterSeat && p.age < SHOOTER_GRACE_S && p.kind !== 'nukelet') continue;
    const dx = p.x - tank.x;
    const dy = p.y - (tank.y - TANK_H / 2);
    const r = TANK_HIT_RADIUS + 6;
    if (dx * dx + dy * dy <= r * r) return tank;
  }
  return null;
}

export { type Rng };
