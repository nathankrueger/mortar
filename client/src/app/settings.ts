/**
 * Player display preferences. Kept out of the React tree so the game modules
 * can read them without importing UI.
 */

const TRACER_KEY = 'mortar.tracer';

/** Tracer tail strength, 0 (off) … 1 (longest). */
export const DEFAULT_TRACER = 0.5;

export function loadTracer(): number {
  try {
    const raw = localStorage.getItem(TRACER_KEY);
    if (raw === null) return DEFAULT_TRACER;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_TRACER;
  } catch {
    return DEFAULT_TRACER;
  }
}

export function saveTracer(v: number): void {
  try {
    localStorage.setItem(TRACER_KEY, String(Math.min(1, Math.max(0, v))));
  } catch {
    /* private mode — the setting just won't survive reloads */
  }
}
