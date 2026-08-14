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

const SALT_TREES = 0x7e33;

/** One cosmetic tree planted on the surface (renderer-only). */
export interface TerrainTree {
  /** Base x (wu); the tree stands on the surface column here. */
  x: number;
  /** Height (wu) — deliberately small scenery, not obstacles. */
  h: number;
  /** Sprite variant: 0/1 = conifer silhouettes, 2 = round crown. */
  kind: number;
}

export interface GeneratedTerrain {
  /** Surface y per column (length worldW). Smaller y = higher ground. */
  heights: Float64Array;
  /** Spawn x for seat 0 (left) and seat 1 (right). */
  spawnX: [number, number];
  macro: MacroFeature;
  themeIndex: number;
  /**
   * Cosmetic side extensions so zoomed-out framing never shows bare sky.
   * Renderer-only — the sim world still ends at [0, worldW). Index 0 is the
   * column adjacent to the world edge, increasing outward.
   */
  apronLeft: Float64Array;
  apronRight: Float64Array;
  /**
   * Cosmetic tree cover. A low-frequency density field splits the map into
   * forest swaths and bare stretches, so whole hillsides read wooded or
   * barren instead of uniform sprinkling. Renderer-only.
   */
  trees: TerrainTree[];
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

function macroOffset(macro: MacroFeature, x: number, worldW: number): number {
  const t = x / worldW;
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

/** Rounded headroom at the height limits (wu). */
const CLAMP_KNEE = 0.08 * WORLD_H;

/**
 * Compress surface y into the allowed band with soft knees: instead of
 * clipping tall peaks (and deep valleys) into dead-flat mesas, the last
 * CLAMP_KNEE wu squash asymptotically, so extreme terrain rounds off and
 * keeps its noise texture.
 */
function softClamp(y: number): number {
  const topKnee = SURFACE_MIN + CLAMP_KNEE;
  if (y < topKnee) {
    const e = topKnee - y;
    return topKnee - (CLAMP_KNEE * e) / (e + CLAMP_KNEE);
  }
  const botKnee = SURFACE_MAX - CLAMP_KNEE;
  if (y > botKnee) {
    const e = y - botKnee;
    return botKnee + (CLAMP_KNEE * e) / (e + CLAMP_KNEE);
  }
  return y;
}

export function generateTerrain(seed: number, worldW = WORLD_W): GeneratedTerrain {
  const rng = mulberry32(deriveSeed(seed, SALT_TERRAIN));
  const w = worldW;

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
  const spawn0 = Math.round(randRange(rng, 0.05, 0.15) * w);
  const spawn1 = Math.round(randRange(rng, 0.85, 0.95) * w);
  const themeIndex = randInt(rng, 0, THEMES.length - 1);

  // 3) Compose surface heights.
  const heights = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const n = noise[x] / ampSum; // ~[0,1]
    const y = BASE_LEVEL - (n - 0.5) * 2 * NOISE_AMPLITUDE - macroOffset(macro, x, w);
    heights[x] = softClamp(y);
  }

  // 4) Cosmetic aprons past both edges (drawn after all gameplay rolls so
  //    earlier RNG consumption — and therefore the playfield — is unchanged).
  const apronW = Math.round(w / 2);
  const mkApron = (edgeH: number): Float64Array => {
    const arr = new Float64Array(apronW);
    const n = new Float64Array(apronW);
    let a = 1;
    let ampSum = 0;
    for (let o = 0; o < 3; o++) {
      addOctave(rng, n, 160 / (1 << o), a);
      ampSum += a;
      a *= PERSISTENCE;
    }
    for (let i = 0; i < apronW; i++) {
      const wild = BASE_LEVEL - (n[i] / ampSum - 0.5) * 2 * NOISE_AMPLITUDE * 1.15;
      const t = smoothstep(Math.min(1, i / 220));
      arr[i] = clamp(edgeH * (1 - t) + wild * t, 0.3 * WORLD_H, 0.95 * WORLD_H);
    }
    return arr;
  };

  // 5) Flatten a landing shelf at each spawn so tanks start level.
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

  // 6) Tree cover from its own child seed (the playfield rolls above are
  //    untouched). Density noise > threshold = forest swath; flats only,
  //    clear of both spawns.
  const trees: TerrainTree[] = [];
  {
    const trng = mulberry32(deriveSeed(seed, SALT_TREES));
    const density = new Float64Array(w);
    let ta = 1;
    let tSum = 0;
    for (let o = 0; o < 2; o++) {
      addOctave(trng, density, 520 / (1 << o), ta);
      tSum += ta;
      ta *= 0.45;
    }
    // Rolled per map: some worlds come out lush, others nearly barren.
    const threshold = randRange(trng, 0.42, 0.62);
    let x = 10;
    while (x < w - 10) {
      const d = density[x] / tSum;
      const slope = Math.abs(
        heights[clamp(x + 5, 0, w - 1)] - heights[clamp(x - 5, 0, w - 1)],
      );
      const nearSpawn = Math.abs(x - spawn0) < 70 || Math.abs(x - spawn1) < 70;
      if (d > threshold && slope < 16 && !nearSpawn) {
        trees.push({
          x: x + randRange(trng, -3, 3),
          h: randRange(trng, 14, 26) * (0.85 + (d - threshold) * 0.9),
          kind: randInt(trng, 0, 2),
        });
        x += Math.round(randRange(trng, 15, 40));
      } else {
        x += 9;
      }
    }
  }

  return {
    heights,
    spawnX: [spawn0, spawn1],
    macro,
    themeIndex,
    apronLeft: mkApron(heights[0]),
    apronRight: mkApron(heights[w - 1]),
    trees,
  };
}
