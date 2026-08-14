import { describe, expect, it } from 'vitest';
import { generateTerrain } from './generate';
import { carveSurfaceCircle, TerrainMask } from './mask';

function flatMask(w = 200, h = 150, surface = 100): TerrainMask {
  const heights = new Float64Array(w).fill(surface);
  return TerrainMask.fromHeights(heights, w, h);
}

describe('TerrainMask.fromHeights', () => {
  it('is solid at/below the surface and air above it', () => {
    const mask = flatMask();
    expect(mask.solidAt(50, 99)).toBe(false);
    expect(mask.solidAt(50, 100)).toBe(true);
    expect(mask.solidAt(50, 149)).toBe(true);
  });

  it('treats sides/above as air and below the floor as bedrock', () => {
    const mask = flatMask();
    expect(mask.solidAt(-1, 120)).toBe(false);
    expect(mask.solidAt(200, 120)).toBe(false);
    expect(mask.solidAt(50, -5)).toBe(false);
    expect(mask.solidAt(50, 150)).toBe(true);
    expect(mask.solidAt(50, 10_000)).toBe(true);
  });

  it('matches generated terrain heights', () => {
    const { heights } = generateTerrain(77);
    const mask = TerrainMask.fromHeights(heights);
    for (let x = 0; x < heights.length; x += 97) {
      const top = Math.round(heights[x]);
      expect(mask.solidAt(x, top - 1)).toBe(false);
      expect(mask.solidAt(x, top)).toBe(true);
      expect(mask.surfaceYAt(x)).toBe(top);
    }
  });
});

describe('carveCircle (falling dirt)', () => {
  it('removes approximately pi*r^2 solid texels from deep ground', () => {
    const mask = flatMask(400, 400, 50);
    const before = mask.solidCount();
    mask.carveCircle(200, 250, 40); // fully inside solid ground
    const removed = before - mask.solidCount();
    const expected = Math.PI * 40 * 40;
    expect(Math.abs(removed - expected) / expected).toBeLessThan(0.03);
  });

  it('a buried blast makes the surface sink — dirt falls into the cavity', () => {
    const mask = flatMask(400, 400, 50);
    mask.carveCircle(200, 250, 40);
    // The column loses an 80-texel chord, so its surface drops by 80.
    expect(mask.surfaceYAt(200)).toBe(130);
    // No cavity survives: everything below the new surface is solid.
    expect(mask.solidAt(200, 250)).toBe(true);
    expect(mask.solidAt(200, 129)).toBe(false);
    // Far field untouched.
    expect(mask.surfaceYAt(120)).toBe(50);
  });

  it('a surface blast digs a crater', () => {
    const mask = flatMask(400, 400, 200);
    mask.carveCircle(200, 200, 30); // centered on the surface
    expect(mask.surfaceYAt(200)).toBe(230); // full chord below surface
    expect(mask.surfaceYAt(180)).toBeGreaterThan(200);
    expect(mask.surfaceYAt(160)).toBe(200); // outside the blast
  });

  it('never leaves floating dirt: columns are single runs', () => {
    const mask = flatMask(300, 300, 120);
    mask.carveCircle(150, 90, 45); // overlaps surface from above
    mask.carveCircle(150, 200, 35); // deep blast
    for (const x of [110, 130, 150, 170, 190]) {
      const s = mask.surfaceYAt(x);
      expect(mask.solidAt(x, s - 1)).toBe(false);
      if (s < 300) expect(mask.solidAt(x, s)).toBe(true);
      expect(mask.solidAt(x, 299)).toBe(true);
    }
  });

  it('clips safely at world edges', () => {
    const mask = flatMask(100, 100, 10);
    mask.carveCircle(0, 50, 30);
    mask.carveCircle(99, 99, 30);
    expect(mask.surfaceYAt(0)).toBeGreaterThan(10);
    expect(mask.surfaceYAt(99)).toBeGreaterThan(10);
  });
});

describe('column queries', () => {
  it('surfaceYAt reports h outside the world', () => {
    const mask = flatMask();
    expect(mask.surfaceYAt(10)).toBe(100);
    expect(mask.surfaceYAt(-1)).toBe(150);
  });

  it('firstSolidBelow clamps to the surface', () => {
    const mask = flatMask();
    expect(mask.firstSolidBelow(10, 0)).toBe(100);
    expect(mask.firstSolidBelow(10, 120)).toBe(120);
    expect(mask.firstSolidBelow(10, 999)).toBe(150);
  });

  it('restingY perches on the highest ground under the footprint', () => {
    const mask = flatMask(300, 300, 150);
    mask.carveCircle(160, 150, 20); // dip right of center
    const rest = mask.restingY(150, 10);
    expect(rest).toBe(150); // still supported by untouched columns at 140-ish
    mask.carveCircle(140, 150, 25); // now the whole footprint sank
    expect(mask.restingY(150, 10)).toBeGreaterThan(150);
  });
});

describe('raycastSegment', () => {
  it('finds the entry point into the ground', () => {
    const mask = flatMask();
    const hit = mask.raycastSegment(50, 80, 50, 130);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeGreaterThanOrEqual(99);
    expect(hit!.y).toBeLessThanOrEqual(101);
  });

  it('returns null for a segment entirely in the air', () => {
    const mask = flatMask();
    expect(mask.raycastSegment(0, 10, 199, 60)).toBeNull();
  });

  it('detects thin pillars crossed at a shallow angle', () => {
    const mask = flatMask(300, 300, 100);
    mask.carveCircle(120, 150, 40);
    mask.carveCircle(205, 150, 40);
    const hit = mask.raycastSegment(100, 150, 220, 150);
    expect(hit).not.toBeNull(); // the pillar between the craters survives
  });

  it('clone isolates mutations', () => {
    const mask = flatMask();
    const copy = mask.clone();
    copy.carveCircle(50, 110, 20);
    expect(copy.surfaceYAt(50)).toBeGreaterThan(100);
    expect(mask.surfaceYAt(50)).toBe(100);
  });
});

describe('carveSurfaceCircle (renderer mirror)', () => {
  it('matches the mask carve within a texel', () => {
    const heights = new Float64Array(300).fill(120);
    const mask = TerrainMask.fromHeights(heights, 300, 300);
    const surfaces = Float64Array.from(heights);
    mask.carveCircle(150, 130, 38);
    const range = carveSurfaceCircle(surfaces, 300, 150, 130, 38);
    expect(range).not.toBeNull();
    for (let x = range!.x0; x <= range!.x1; x++) {
      expect(Math.abs(surfaces[x] - mask.surfaceYAt(x))).toBeLessThanOrEqual(1);
    }
  });

  it('returns null when the circle misses all ground', () => {
    const surfaces = new Float64Array(100).fill(90);
    expect(carveSurfaceCircle(surfaces, 100, 50, 20, 15)).toBeNull();
  });
});

describe('edge carves and aprons', () => {
  it('the apron re-anchors on a carved edge instead of standing as a wall', () => {
    const w = 400;
    const h = 600;
    const surface = 300;
    const heights = new Float64Array(w).fill(surface);
    const apron = new Float64Array(220).fill(surface);
    const mask = TerrainMask.fromHeights(heights, w, h, { left: apron, right: apron });
    mask.carveCircle(w - 1, surface, 60); // blast centered on the right edge
    const edge = mask.surfaceYAt(w - 1);
    expect(edge).toBeGreaterThan(surface + 20); // the crater actually dug in
    // Just outside the world the apron now starts at the carved edge height…
    expect(Math.abs(mask.surfaceYAt(w) - edge)).toBeLessThanOrEqual(2);
    // …descends smoothly (no step over the repose scale anywhere in the blend)…
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(mask.surfaceYAt(w + i + 1) - mask.surfaceYAt(w + i))).toBeLessThan(9);
    }
    // …and returns to the original scenery further out.
    expect(mask.surfaceYAt(w + 219)).toBe(surface);
  });
});
