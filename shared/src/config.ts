import { z } from 'zod';
import { WIND_MAX_DEFAULT } from './constants';
import { triangular, type Rng } from './rng';

// Everything the lobby host can tune. All gameplay code reads from a
// MatchConfig instance rather than hardcoding these numbers.
export const MatchConfigSchema = z.object({
  /** Battlefield width in wu; muzzle power scales with it automatically. */
  worldWidth: z.number().int().min(1200).max(4800).multipleOf(100).default(2400),
  startingCredits: z.number().int().min(0).max(1_000_000).default(10_000),
  startingHp: z.number().int().min(25).max(500).default(100),
  /** Credits granted at the start of every turn, win or lose. */
  turnAllowance: z.number().int().min(0).max(100_000).default(1_000),
  /** Seconds per turn (aiming + shopping). 0 disables the timer. */
  turnSeconds: z.number().int().min(0).max(600).default(60),
  windMax: z.number().int().min(0).max(300).default(WIND_MAX_DEFAULT),
  /**
   * Shot-tracer tail length, 0 (off) … 100. A room setting, not a per-browser
   * one: everyone in a match sees the same battlefield.
   */
  tracer: z.number().int().min(0).max(100).default(50),
});

export type MatchConfig = z.infer<typeof MatchConfigSchema>;

export const DEFAULT_CONFIG: MatchConfig = MatchConfigSchema.parse({});

/** Largest per-turn wind change, as a fraction of windMax. */
export const WIND_DRIFT_FRAC = 0.18;

/**
 * Wind evolves as a slow random walk: each turn it shifts by a small bounded
 * step instead of being re-rolled, so players can learn and lead it.
 */
export function driftWind(prev: number, rng: Rng, windMax: number): number {
  const delta = triangular(rng, windMax * WIND_DRIFT_FRAC);
  return Math.round(Math.min(windMax, Math.max(-windMax, prev + delta)));
}

/** Merge a partial (e.g. lobby edits) over defaults, clamping via the schema. */
export function resolveConfig(partial?: unknown): MatchConfig {
  if (partial == null || typeof partial !== 'object') return { ...DEFAULT_CONFIG };
  const merged = { ...DEFAULT_CONFIG, ...(partial as Record<string, unknown>) };
  const parsed = MatchConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...DEFAULT_CONFIG };
}
