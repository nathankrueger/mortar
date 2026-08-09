import {
  ANGLE_MAX,
  ANGLE_MIN,
  GRAVITY,
  MUZZLE_SPEED_PER_POWER,
  POWER_MAX,
  POWER_MIN,
  TANK_H,
} from '../constants';
import { resolveShot } from '../sim/sim';
import type { Seat, ShotContext, SimEvent, SimTank } from '../sim/types';
import type { TerrainMask } from '../terrain/mask';
import type { WeaponId } from '../weapons';
import { AI_PROFILES, type AiDifficulty } from './difficulty';

// The AI aims by actually simulating candidate shots with the real engine
// (including the true per-turn seed, wind, and terrain), then hill-climbing.
// Difficulty controls search depth and how much gaussian error corrupts the
// final answer. Math.random is fine here — the AI runs on one machine only.

export interface AiAimContext {
  mask: TerrainMask;
  tanks: SimTank[];
  wind: number;
  shotSeed: number;
  seat: Seat;
}

export interface AiPlan {
  angleDeg: number;
  power: number;
  score: number;
}

function clampAngle(a: number): number {
  return Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, a));
}
function clampPower(p: number): number {
  return Math.min(POWER_MAX, Math.max(POWER_MIN, p));
}

function gaussian(sigma: number): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
}

/** Simulate one candidate and score it from the shooter's perspective. */
export function evaluateShot(
  ctx: AiAimContext,
  weapon: WeaponId,
  angleDeg: number,
  power: number,
): number {
  const me = ctx.tanks.find((t) => t.seat === ctx.seat)!;
  const enemy = ctx.tanks.find((t) => t.seat !== ctx.seat)!;
  const enemyPos = { x: enemy.x, y: enemy.y - TANK_H / 2 };

  const simCtx: ShotContext = {
    mask: ctx.mask.clone(),
    tanks: ctx.tanks.map((t) => ({ ...t })),
    wind: ctx.wind,
    seed: ctx.shotSeed,
  };
  const out = resolveShot(simCtx, { seat: ctx.seat, weapon, angleDeg, power });
  return scoreEvents(out.events, ctx.seat, enemyPos, me);
}

function scoreEvents(
  events: SimEvent[],
  mySeat: Seat,
  enemyPos: { x: number; y: number },
  me: SimTank,
): number {
  let dmgEnemy = 0;
  let dmgSelf = 0;
  let enemyDied = false;
  let selfDied = false;
  let closest = Infinity;
  for (const e of events) {
    if (e.t === 'damage' || e.t === 'fall') {
      const amount = e.t === 'damage' ? e.amount : e.dmg;
      if (e.seat === mySeat) dmgSelf += amount;
      else dmgEnemy += amount;
    } else if (e.t === 'die') {
      if (e.seat === mySeat) selfDied = true;
      else enemyDied = true;
    } else if (e.t === 'explode') {
      const d = Math.hypot(e.x - enemyPos.x, e.y - enemyPos.y);
      closest = Math.min(closest, d);
    }
  }
  let score = dmgEnemy * 12 - dmgSelf * 18;
  if (enemyDied) score += 4000;
  if (selfDied) score -= 6000;
  if (Number.isFinite(closest)) score += Math.max(0, 420 - closest) * 0.8;
  void me;
  return score;
}

/** Ballistic first guesses: several arcs whose flat range reaches the enemy. */
function seedCandidates(ctx: AiAimContext, count: number): { angleDeg: number; power: number }[] {
  const me = ctx.tanks.find((t) => t.seat === ctx.seat)!;
  const enemy = ctx.tanks.find((t) => t.seat !== ctx.seat)!;
  const dx = enemy.x - me.x;
  const dist = Math.max(60, Math.abs(dx));
  const arcs = [38, 52, 63, 74, 82].slice(0, Math.max(2, count));
  const out: { angleDeg: number; power: number }[] = [];
  for (const arc of arcs) {
    const rad = (arc * Math.PI) / 180;
    const v = Math.sqrt((GRAVITY * dist) / Math.max(0.2, Math.sin(2 * rad)));
    const power = clampPower(v / MUZZLE_SPEED_PER_POWER);
    const angle = dx >= 0 ? arc : 180 - arc;
    out.push({ angleDeg: clampAngle(angle), power });
  }
  return out;
}

export interface PlanShotOptions {
  /** Yield to the event loop every N simulations (keeps the UI fluid). */
  sliceEvery?: number;
  signal?: { cancelled: boolean };
}

/** Full search: seeds → pick best → hill-climb → difficulty error. */
export async function planShot(
  ctx: AiAimContext,
  weapon: WeaponId,
  difficulty: AiDifficulty,
  opts: PlanShotOptions = {},
): Promise<AiPlan> {
  const profile = AI_PROFILES[difficulty];
  const sliceEvery = opts.sliceEvery ?? 5;
  let sims = 0;
  const maybeYield = async () => {
    sims++;
    if (sims % sliceEvery === 0) await new Promise((r) => setTimeout(r, 0));
  };

  let best: AiPlan = { angleDeg: 60, power: 50, score: -Infinity };
  for (const c of seedCandidates(ctx, profile.baseCandidates)) {
    if (opts.signal?.cancelled) return best;
    const score = evaluateShot(ctx, weapon, c.angleDeg, c.power);
    await maybeYield();
    if (score > best.score) best = { ...c, score };
  }

  let stepAngle = 7;
  let stepPower = 7;
  for (let i = 0; i < profile.climbs; i++) {
    if (opts.signal?.cancelled) return best;
    const angleDeg = clampAngle(best.angleDeg + (Math.random() * 2 - 1) * stepAngle);
    const power = clampPower(best.power + (Math.random() * 2 - 1) * stepPower);
    const score = evaluateShot(ctx, weapon, angleDeg, power);
    await maybeYield();
    if (score > best.score) {
      best = { angleDeg, power, score };
    } else {
      stepAngle = Math.max(1.5, stepAngle * 0.88);
      stepPower = Math.max(1.5, stepPower * 0.88);
    }
  }

  return {
    angleDeg: clampAngle(best.angleDeg + gaussian(profile.angleSigma)),
    power: clampPower(best.power + gaussian(profile.powerSigma)),
    score: best.score,
  };
}
