import { describe, expect, it } from 'vitest';
import { WORLD_H, WORLD_W } from '../constants';
import { generateTerrain } from '../terrain/generate';
import { TerrainMask } from '../terrain/mask';
import { WEAPONS, type WeaponId } from '../weapons';
import { flatRange } from './ballistics';
import { applyExplosion } from './explosions';
import { resolveShot } from './sim';
import { settleTanks } from './tanks';
import type { ShotContext, ShotParams, SimEvent, SimTank } from './types';

const FLAT_Y = 900;

function flatHeights(y = FLAT_Y): Float64Array {
  return new Float64Array(WORLD_W).fill(y);
}

function makeCtx(opts?: {
  heights?: Float64Array;
  tank0?: [number, number];
  tank1?: [number, number];
  hp?: number;
  wind?: number;
  seed?: number;
}): ShotContext {
  const heights = opts?.heights ?? flatHeights();
  const mask = TerrainMask.fromHeights(heights);
  const [x0, y0] = opts?.tank0 ?? [500, FLAT_Y];
  const [x1, y1] = opts?.tank1 ?? [1900, FLAT_Y];
  const hp = opts?.hp ?? 100;
  const tanks: SimTank[] = [
    { seat: 0, x: x0, y: y0, hp, alive: true },
    { seat: 1, x: x1, y: y1, hp, alive: true },
  ];
  return { mask, tanks, wind: opts?.wind ?? 0, seed: opts?.seed ?? 42 };
}

function fire(ctx: ShotContext, params: Partial<ShotParams> & { weapon?: WeaponId }) {
  return resolveShot(ctx, {
    seat: 0,
    weapon: 'mortar',
    angleDeg: 45,
    power: 50,
    ...params,
  });
}

const ofType = <T extends SimEvent['t']>(events: SimEvent[], t: T) =>
  events.filter((e) => e.t === t) as Extract<SimEvent, { t: T }>[];

describe('resolveShot basics', () => {
  it('fires, flies, explodes, and carves', () => {
    const ctx = makeCtx();
    const before = ctx.mask.solidCount();
    const out = fire(ctx, { angleDeg: 45, power: 50 });
    expect(ofType(out.events, 'spawn')).toHaveLength(1);
    expect(ofType(out.events, 'explode')).toHaveLength(1);
    expect(ofType(out.events, 'carve')).toHaveLength(1);
    expect(ctx.mask.solidCount()).toBeLessThan(before);
    expect(out.ticks).toBeGreaterThan(0);
    expect(out.ticks).toBeLessThan(2400);
  });

  it('lands near the closed-form flat range with no wind', () => {
    const ctx = makeCtx({ tank1: [2350, FLAT_Y] }); // move the enemy out of the way
    const out = fire(ctx, { angleDeg: 45, power: 40 });
    const range = flatRange(45, 40); // ≈ 392
    const explode = ofType(out.events, 'explode')[0];
    expect(explode).toBeDefined();
    // Muzzle offset (+~21 wu forward, +30 wu launch height) stretches the
    // parabola beyond the closed form; allow that plus integration error.
    expect(Math.abs(explode.x - (500 + range))).toBeLessThan(range * 0.15 + 25);
  });

  it('wind bends the trajectory', () => {
    const still = fire(makeCtx({ wind: 0, tank1: [2350, FLAT_Y] }), { power: 40 });
    const tail = fire(makeCtx({ wind: 100, tank1: [2350, FLAT_Y] }), { power: 40 });
    const head = fire(makeCtx({ wind: -100, tank1: [2350, FLAT_Y] }), { power: 40 });
    const x = (o: typeof still) => ofType(o.events, 'explode')[0].x;
    expect(x(tail)).toBeGreaterThan(x(still) + 10);
    expect(x(head)).toBeLessThan(x(still) - 10);
  });

  it('is fully deterministic', () => {
    const a = fire(makeCtx({ seed: 777 }), { weapon: 'bounceBomb', angleDeg: 60, power: 65 });
    const b = fire(makeCtx({ seed: 777 }), { weapon: 'bounceBomb', angleDeg: 60, power: 65 });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

describe('damage', () => {
  it('direct hit multiplies damage and reports direct', () => {
    // Flat, close-range, near-horizontal shot straight into the enemy hull.
    const ctx = makeCtx({ tank0: [500, FLAT_Y], tank1: [640, FLAT_Y] });
    const out = fire(ctx, { angleDeg: 4, power: 70 });
    const dmg = ofType(out.events, 'damage').find((d) => d.seat === 1);
    expect(dmg).toBeDefined();
    expect(dmg!.direct).toBe(true);
    expect(dmg!.amount).toBe(Math.round(WEAPONS.mortar.dmg * 1.85));
    expect(out.directHits).toBe(1);
    expect(out.damageToOpponent).toBe(dmg!.amount);
  });

  it('splash falls off monotonically with distance and stops at the radius', () => {
    // Unit-level: one explosion, enemy tanks at increasing distances.
    const dmgAt = (dist: number): number => {
      const ctx = makeCtx({ tank1: [1000 + dist, FLAT_Y] });
      const events: SimEvent[] = [];
      applyExplosion(ctx, events, {
        id: 1,
        x: 1000,
        y: FLAT_Y - 9, // hull-center height
        blastR: 60,
        dmg: 40,
        tier: 0,
        tick: 0,
        directTank: null,
        shooterSeat: 0,
        tally: { damageToOpponent: 0, directHits: 0 },
      });
      const d = events.find((e) => e.t === 'damage' && e.seat === 1) as
        | Extract<SimEvent, { t: 'damage' }>
        | undefined;
      return d?.amount ?? 0;
    };
    const near = dmgAt(20);
    const mid = dmgAt(45);
    const edge = dmgAt(70);
    const outside = dmgAt(90); // 90 - 16 hull grace = 74 dist ≥ 60 radius
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(edge);
    expect(outside).toBe(0);
    expect(near).toBeLessThanOrEqual(40);
  });

  it('a shell straight up comes back down on the shooter (self-damage)', () => {
    const ctx = makeCtx();
    const out = fire(ctx, { angleDeg: 90, power: 30 });
    const dmg = ofType(out.events, 'damage');
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg[0].seat).toBe(0);
    expect(out.damageToOpponent).toBe(0);
  });

  it('kills and emits die at 0 hp', () => {
    const ctx = makeCtx({ tank0: [500, FLAT_Y], tank1: [640, FLAT_Y], hp: 10 });
    const out = fire(ctx, { angleDeg: 4, power: 70 });
    expect(ofType(out.events, 'die').some((d) => d.seat === 1)).toBe(true);
    expect(ctx.tanks[1].alive).toBe(false);
  });
});

describe('weapon behaviors', () => {
  it('mirv splits into 5 warheads at apex', () => {
    const out = fire(makeCtx(), { weapon: 'mirv', angleDeg: 75, power: 70 });
    expect(ofType(out.events, 'split')).toHaveLength(1);
    const warheads = ofType(out.events, 'spawn').filter((s) => s.kind === 'warhead');
    expect(warheads).toHaveLength(5);
  });

  it('multi mirv splits into 9', () => {
    const out = fire(makeCtx(), { weapon: 'multiMirv', angleDeg: 75, power: 70 });
    const warheads = ofType(out.events, 'spawn').filter((s) => s.kind === 'warhead');
    expect(warheads).toHaveLength(9);
  });

  it('a mirv that hits before apex explodes as a single shell', () => {
    // Wall right in front of the muzzle.
    const heights = flatHeights();
    for (let x = 700; x < 760; x++) heights[x] = 300;
    const out = fire(makeCtx({ heights }), { weapon: 'mirv', angleDeg: 10, power: 90 });
    expect(ofType(out.events, 'split')).toHaveLength(0);
    expect(ofType(out.events, 'explode')).toHaveLength(1);
  });

  it('bounce bomb detonates on every hop, then a finale (or duds out)', () => {
    let bouncesSeen = 0;
    let duds = 0;
    for (let seed = 0; seed < 250; seed++) {
      const out = fire(makeCtx({ seed, tank1: [2350, FLAT_Y] }), {
        weapon: 'bounceBomb',
        angleDeg: 55,
        power: 55,
      });
      const bounces = ofType(out.events, 'bounce').length;
      const explodes = ofType(out.events, 'explode').length;
      const fizzles = ofType(out.events, 'fizzle').length;
      bouncesSeen += bounces;
      expect(bounces).toBeLessThanOrEqual(6);
      // Every hop carries its own explosion...
      expect(explodes).toBeGreaterThanOrEqual(bounces);
      // ...and the shot ends in either a finale blast or a dud fizzle.
      if (fizzles === 0) expect(explodes).toBe(bounces + 1);
      else duds++;
    }
    expect(bouncesSeen / 250).toBeGreaterThan(2); // it genuinely hops around
    const dudRate = duds / 250;
    expect(dudRate).toBeGreaterThan(0.08);
    expect(dudRate).toBeLessThan(0.3);
  });

  it('mnw hitting before apex detonates as a single small nuke', () => {
    const heights = flatHeights();
    for (let x = 700; x < 760; x++) heights[x] = 300; // wall by the muzzle
    const out = fire(makeCtx({ heights }), { weapon: 'mnw', angleDeg: 10, power: 90 });
    expect(ofType(out.events, 'split')).toHaveLength(0);
    const explode = ofType(out.events, 'explode');
    expect(explode).toHaveLength(1);
    expect(explode[0].r).toBe(WEAPONS.mnw.blastR);
  });

  it('mega mnw splits into large-nuke warheads at apex', () => {
    const out = fire(makeCtx({ tank1: [2350, FLAT_Y] }), {
      weapon: 'megaMnw',
      angleDeg: 60,
      power: 60,
    });
    expect(ofType(out.events, 'split')).toHaveLength(1);
    const nukelets = ofType(out.events, 'spawn').filter((s) => s.kind === 'nukelet');
    expect(nukelets.length).toBeGreaterThanOrEqual(1);
    expect(nukelets.length).toBeLessThanOrEqual(5);
    for (const e of ofType(out.events, 'explode')) expect(e.r).toBe(WEAPONS.megaMnw.blastR);
  });

  it('mnw launches 1..5 nukelets with the advertised distribution', () => {
    const counts: number[] = [];
    for (let seed = 0; seed < 300; seed++) {
      const out = fire(makeCtx({ seed, tank1: [2350, FLAT_Y] }), {
        weapon: 'mnw',
        angleDeg: 50,
        power: 50,
      });
      const nukelets = ofType(out.events, 'spawn').filter((s) => s.kind === 'nukelet');
      expect(nukelets.length).toBeGreaterThanOrEqual(1);
      expect(nukelets.length).toBeLessThanOrEqual(5);
      counts.push(nukelets.length);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(2.8); // EV = 3.15
    expect(mean).toBeLessThan(3.5);
  });

  it('mirv bounce: 5 hopping warheads, each at most 2 hops, none dud', () => {
    const out = fire(makeCtx({ tank1: [2350, FLAT_Y] }), {
      weapon: 'mirvBounce',
      angleDeg: 70,
      power: 70,
    });
    const warheads = ofType(out.events, 'spawn').filter((s) => s.kind === 'warhead');
    expect(warheads).toHaveLength(5);
    for (const b of ofType(out.events, 'bounce')) expect(b.n).toBeLessThanOrEqual(2);
    const bounces = ofType(out.events, 'bounce').length;
    const resolved =
      ofType(out.events, 'explode').length +
      ofType(out.events, 'fizzle').filter((f) => f.y > 0).length;
    // hop blasts + one finale per surviving warhead
    expect(resolved).toBeGreaterThanOrEqual(Math.max(5, bounces + 1));
  });
});

describe('configurable field width', () => {
  it('max-power range scales to roughly span any field width', () => {
    for (const w of [1600, 2400, 3600, 4800]) {
      const range = flatRange(45, 100, w);
      expect(Math.abs(range - w) / w).toBeLessThan(0.01);
    }
  });

  it('terrain generates at the configured width with proportional spawns', () => {
    const g = generateTerrain(5, 3600);
    expect(g.heights.length).toBe(3600);
    expect(g.spawnX[0]).toBeGreaterThanOrEqual(180);
    expect(g.spawnX[0]).toBeLessThanOrEqual(540);
    expect(g.spawnX[1]).toBeGreaterThanOrEqual(3060);
    expect(g.spawnX[1]).toBeLessThanOrEqual(3420);
  });

  it('a near-max shot crosses a massive field', () => {
    const heights = new Float64Array(4800).fill(900);
    const mask = TerrainMask.fromHeights(heights);
    const tanks: SimTank[] = [
      { seat: 0, x: 500, y: 900, hp: 100, alive: true },
      { seat: 1, x: 4700, y: 900, hp: 100, alive: true },
    ];
    const out = resolveShot(
      { mask, tanks, wind: 0, seed: 3 },
      { seat: 0, weapon: 'mortar', angleDeg: 45, power: 92 },
    );
    const explode = ofType(out.events, 'explode')[0];
    expect(explode).toBeDefined();
    expect(explode.x).toBeGreaterThan(3900); // far side of a 4800 field
  });
});

describe('new weapon behaviors', () => {
  it('dirt bomb adds terrain instead of damaging', () => {
    const ctx = makeCtx({ tank1: [2350, FLAT_Y] });
    const before = ctx.mask.solidCount();
    const out = fire(ctx, { weapon: 'dirtBomb', angleDeg: 45, power: 45 });
    expect(ctx.mask.solidCount()).toBeGreaterThan(before);
    expect(ofType(out.events, 'damage')).toHaveLength(0);
    const carve = ofType(out.events, 'carve')[0];
    expect(carve.circles[0].add).toBe(true);
  });

  it('roller rolls downhill and detonates near the valley floor', () => {
    // V-shaped valley with its bottom at x=1200.
    const heights = new Float64Array(WORLD_W);
    for (let x = 0; x < WORLD_W; x++) heights[x] = 1100 - Math.abs(x - 1200) * 0.25;
    const ctx = makeCtx({ heights, tank0: [500, 1100 - 700 * 0.25], tank1: [2340, 815] });
    const out = fire(ctx, { weapon: 'roller', angleDeg: 55, power: 45 });
    const explode = ofType(out.events, 'explode')[0];
    expect(explode).toBeDefined();
    expect(Math.abs(explode.x - 1200)).toBeLessThan(160);
  });

  it('digger detonates below the surface', () => {
    const ctx = makeCtx({ tank1: [2350, FLAT_Y] });
    const out = fire(ctx, { weapon: 'digger', angleDeg: 45, power: 50 });
    const explode = ofType(out.events, 'explode')[0];
    expect(explode).toBeDefined();
    expect(explode.y).toBeGreaterThan(FLAT_Y + 25); // well under the old surface
  });

  it('airstrike rains six shells from the sky', () => {
    const ctx = makeCtx({ tank1: [2350, FLAT_Y] });
    const out = fire(ctx, { weapon: 'airstrike', angleDeg: 45, power: 50 });
    const rain = ofType(out.events, 'spawn').filter((s) => s.kind === 'warhead');
    expect(rain).toHaveLength(6);
    for (const s of rain) expect(s.y).toBeLessThan(0); // spawned above the sky
    expect(ofType(out.events, 'explode').length).toBeGreaterThanOrEqual(5);
  });

  it('sniper hits hard on a direct hit despite the tiny blast', () => {
    const ctx = makeCtx({ tank0: [500, FLAT_Y], tank1: [640, FLAT_Y] });
    const out = fire(ctx, { weapon: 'sniper', angleDeg: 4, power: 70 });
    const dmg = ofType(out.events, 'damage').find((d) => d.seat === 1);
    expect(dmg?.direct).toBe(true);
    expect(dmg?.amount).toBe(Math.round(30 * 1.85));
  });
});

describe('falls', () => {
  function ledgeCtx() {
    const heights = flatHeights(900);
    for (let x = 1180; x <= 1260; x++) heights[x] = 650; // pillar with a flat top
    const mask = TerrainMask.fromHeights(heights);
    const tanks: SimTank[] = [
      { seat: 0, x: 300, y: 900, hp: 100, alive: true },
      { seat: 1, x: 1220, y: 650, hp: 100, alive: true },
    ];
    return { mask, tanks, wind: 0, seed: 1 } satisfies ShotContext;
  }

  it('a tank falls when the ground under it is carved away and takes fall damage', () => {
    const ctx = ledgeCtx();
    const events: SimEvent[] = [];
    // Blow out the pillar just beneath the tank.
    applyExplosion(ctx, events, {
      id: 99,
      x: 1220,
      y: 700,
      blastR: 60,
      dmg: 10,
      tier: 0,
      tick: 0,
      directTank: null,
      shooterSeat: 0,
      tally: { damageToOpponent: 0, directHits: 0 },
    });
    settleTanks(ctx, events, 1);
    const fall = events.find((e) => e.t === 'fall' && e.seat === 1) as Extract<
      SimEvent,
      { t: 'fall' }
    >;
    expect(fall).toBeDefined();
    expect(fall.toY).toBeGreaterThan(fall.fromY + 100);
    const dist = fall.toY - fall.fromY;
    expect(fall.dmg).toBe(Math.round(Math.min(60, 0.15 * Math.max(0, dist - 48))));
    // hp reflects fall damage plus any splash from the triggering blast.
    const splash = events
      .filter((e): e is Extract<SimEvent, { t: 'damage' }> => e.t === 'damage' && e.seat === 1)
      .reduce((sum, e) => sum + e.amount, 0);
    expect(ctx.tanks[1].hp).toBe(100 - splash - fall.dmg);
  });

  it('short drops are free', () => {
    const ctx = ledgeCtx();
    // Shave a sliver under the tank: it drops < 48 wu.
    ctx.mask.carveCircle(1220, 660, 24);
    const events: SimEvent[] = [];
    settleTanks(ctx, events, 0);
    const fall = events.find((e) => e.t === 'fall' && e.seat === 1) as
      | Extract<SimEvent, { t: 'fall' }>
      | undefined;
    if (fall) {
      expect(fall.toY - fall.fromY).toBeLessThan(60);
      expect(fall.dmg).toBe(
        Math.round(Math.min(60, 0.15 * Math.max(0, fall.toY - fall.fromY - 48))),
      );
    }
  });
});

describe('robustness fuzz', () => {
  it('every shot terminates and every projectile resolves', () => {
    const weapons = Object.keys(WEAPONS) as WeaponId[];
    for (let i = 0; i < 150; i++) {
      const seed = i * 7919 + 13;
      const weapon = weapons[i % weapons.length];
      const angle = 5 + (i * 37) % 170;
      const power = 10 + (i * 13) % 90;
      const wind = ((i * 29) % 241) - 120;
      const ctx = makeCtx({ seed, wind });
      const out = fire(ctx, { weapon, angleDeg: angle, power });
      expect(out.ticks).toBeLessThanOrEqual(2400);
      const spawns = ofType(out.events, 'spawn').length;
      const resolutions =
        ofType(out.events, 'explode').length +
        ofType(out.events, 'fizzle').length +
        ofType(out.events, 'split').length;
      expect(resolutions).toBeGreaterThanOrEqual(spawns > 0 ? 1 : 0);
      // Every spawned projectile leaves exactly one terminal event.
      const terminal = new Map<number, number>();
      for (const e of out.events) {
        if (e.t === 'explode' || e.t === 'fizzle' || e.t === 'split') {
          terminal.set(e.id, (terminal.get(e.id) ?? 0) + 1);
        }
      }
      for (const s of ofType(out.events, 'spawn')) {
        expect(terminal.get(s.id) ?? 0).toBe(1);
      }
    }
  });
});
