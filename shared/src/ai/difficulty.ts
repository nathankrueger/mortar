export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface AiProfile {
  /** Distinct launch arcs seeded from ballistics before refinement. */
  baseCandidates: number;
  /** Hill-climb refinement steps. */
  climbs: number;
  /** Gaussian error applied to the final solution (degrees / power units). */
  angleSigma: number;
  powerSigma: number;
  /** Pause range while "thinking", ms. */
  thinkMs: [number, number];
  /** Chance to just lob a basic mortar even when better ammo exists. */
  mortarBias: number;
  /** Fraction of credits the AI is willing to spend when shopping. */
  shopBudgetFrac: number;
  label: string;
}

export const AI_PROFILES: Record<AiDifficulty, AiProfile> = {
  easy: {
    baseCandidates: 3,
    climbs: 5,
    angleSigma: 8,
    powerSigma: 7,
    thinkMs: [900, 1700],
    mortarBias: 0.45,
    shopBudgetFrac: 0.55,
    label: 'Easy',
  },
  medium: {
    baseCandidates: 4,
    climbs: 10,
    angleSigma: 3.5,
    powerSigma: 3.5,
    thinkMs: [700, 1300],
    mortarBias: 0.15,
    shopBudgetFrac: 0.8,
    label: 'Medium',
  },
  hard: {
    baseCandidates: 5,
    climbs: 18,
    angleSigma: 1.3,
    powerSigma: 1.4,
    thinkMs: [500, 1000],
    mortarBias: 0,
    shopBudgetFrac: 0.95,
    label: 'Hard',
  },
};
