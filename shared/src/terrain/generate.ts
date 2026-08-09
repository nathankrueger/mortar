import { WORLD_H, WORLD_W } from '../constants';
import { deriveSeed, mulberry32, randInt, randRange, type Rng } from './../rng';
import { THEMES } from './themes';

// Terrain generation MUST be identical on every JS engine — both clients build
// the battlefield from the same seed. Only exactly-specified IEEE-754 ops are
// used: + - * / and comparisons (no Math.sin/pow/exp).

const SALT_TERRAIN = 0x7e21;

const SURFACE_MIN = 0.4 * WORLD_H; // highest allowed surface (smaller y = higher)
const SURFACE_MAX = 0.92 * WORLD_H;
const BASE_LEVEL = 0.62 * WORLD_H;
const NOISE_AMPLITUDE = 0.26 * WORLD_H;

const OCTAVES = 5;
const BASE_SPACING = 96; // wu between lattice points at octave 0
const PERSISTENCE = 0.5;

const SPAWN_SHELF_HALF = 32; // flat shelf half-width around each spawn
const SPAWN_BLEND = 24; // extra margin blending shelf back into terrain

export type MacroFeature = 'rolling' | 'plateau' | 'twin-peaks' | 'canyon';
const MACRO_FEATURES: readonly MacroFeature[] = ['rolling', 'plateau', 'twin-peaks', 'canyon'];

export interface GeneratedTerrain {
  /** Surface y per column (length WORLD_W). Smaller y = higher ground. */
  heights: Float64Array;
  /** Spawn x for seat 0 (left) and seat 1 (right). */
  spawnX: [number, number];
  macro: MacroFeature;
  themeIndex: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Quartic bump: 1 at center, 0 at |t|>=1. Engine-safe replacement for a gaussian. */
function bump(t: number): number {
  const a = 1 - t * t;
  return a > 0 ? a * a : 0;
}

/** One octave of 1D value noise sampled at every integer x in [0, w). */
function addOctave(rng: Rng, out: Float64Array, spacing: number, amplitude: number): void {
  const count = Math.floor(out.length / spacing) + 2;
  const lattice = new Float64Array(count);
  for (let i = 0; i < count; i++) lattice[i] = rng();
  for (let x = 0; x < out.length; x++) {
    const fx = x / spacing;
    const i = Math.floor(fx);
    const t = smoothstep(fx - i);
    out[x] += (lattice[i] * (1 - t) + lattice[i + 1] * t) * amplitude;
  }
}

function macroOffset(macro: MacroFeature, x: number): number {
  const t = x / WORLD_W;
  switch (macro) {
    case 'rolling':
      return 0;
    case 'plateau':
      // Broad raised table across the middle half of the map.
      return 0.14 * WORLD_H * bump((t - 0.5) / 0.42);
    case 'twin-peaks':
      return (
        0.17 * WORLD_H * bump((t - 0.32) / 0.17) + 0.17 * WORLD_H * bump((t - 0.68) / 0.17)
      );
    case 'canyon':
      return -0.16 * WORLD_H * bump((t - 0.5) / 0.2);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function generateTerrain(seed: number): GeneratedTerrain {
  const rng = mulberry32(deriveSeed(seed, SALT_TERRAIN));
  const w = WORLD_W;

  // 1) Fractal value noise. RNG consumption order is fixed — never reorder.
  const noise = new Float64Array(w);
  let amp = 1;
  let ampSum = 0;
  for (let o = 0; o < OCTAVES; o++) {
    const spacing = BASE_SPACING / (1 << o);
    addOctave(rng, noise, spacing, amp);
    ampSum += amp;
    amp *= PERSISTENCE;
  }

  // 2) Macro landform + spawn slots + theme (rolled after noise, fixed order).
  const macro = MACRO_FEATURES[randInt(rng, 0, MACRO_FEATURES.length - 1)];
  const spawn0 = Math.round(randRange(rng, 0.1, 0.2) * w);
  const spawn1 = Math.round(randRange(rng, 0.8, 0.9) * w);
  const themeIndex = randInt(rng, 0, THEMES.length - 1);

  // 3) Compose surface heights.
  const heights = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const n = noise[x] / ampSum; // ~[0,1]
    const y = BASE_LEVEL - (n - 0.5) * 2 * NOISE_AMPLITUDE - macroOffset(macro, x);
    heights[x] = clamp(y, SURFACE_MIN, SURFACE_MAX);
  }

  // 4) Flatten a landing shelf at each spawn so tanks start level.
  for (const sx of [spawn0, spawn1]) {
    const shelfY = heights[clamp(sx, 0, w - 1)];
    const from = Math.max(0, sx - SPAWN_SHELF_HALF - SPAWN_BLEND);
    const to = Math.min(w - 1, sx + SPAWN_SHELF_HALF + SPAWN_BLEND);
    for (let x = from; x <= to; x++) {
      const d = Math.abs(x - sx);
      if (d <= SPAWN_SHELF_HALF) {
        heights[x] = shelfY;
      } else {
        const t = smoothstep((d - SPAWN_SHELF_HALF) / SPAWN_BLEND);
        heights[x] = shelfY * (1 - t) + heights[x] * t;
      }
    }
  }

  return { heights, spawnX: [spawn0, spawn1], macro, themeIndex };
}
