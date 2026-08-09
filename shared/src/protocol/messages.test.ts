import { describe, expect, it } from 'vitest';
import { WORLD_W } from '../constants';
import { resolveShot } from '../sim/sim';
import { TerrainMask } from '../terrain/mask';
import type { SimTank } from '../sim/types';
import { summarizeShotEvents } from '../match/events';
import {
  decodeClient,
  decodeServer,
  encode,
  type ClientMsg,
  type ServerMsg,
} from './messages';

describe('client messages', () => {
  it('round-trips create/join/fire', () => {
    const msgs: ClientMsg[] = [
      { type: 'room:create', v: 1, nickname: 'Nate' },
      { type: 'room:join', v: 1, code: 'BCDF', nickname: 'Kim' },
      { type: 'lobby:ready', ready: true },
      { type: 'shop:buy', weapon: 'mirv', qty: 2 },
      { type: 'turn:aim', angleDeci: 653, power: 72 },
    ];
    for (const m of msgs) {
      expect(decodeClient(encode(m))).toEqual(m);
    }
  });

  it('rejects malformed payloads', () => {
    expect(decodeClient('not json')).toBeNull();
    expect(decodeClient('{}')).toBeNull();
    expect(decodeClient(JSON.stringify({ type: 'nope' }))).toBeNull();
    expect(decodeClient(JSON.stringify({ type: 'shop:buy', weapon: 'bazooka', qty: 1 }))).toBeNull();
    expect(decodeClient(JSON.stringify({ type: 'turn:aim', angleDeci: 9999, power: 50 }))).toBeNull();
    expect(
      decodeClient(JSON.stringify({ type: 'room:join', v: 1, code: 'TOOLONG', nickname: 'x' })),
    ).toBeNull();
  });

  it('uppercases room codes', () => {
    const m = decodeClient(
      JSON.stringify({ type: 'room:join', v: 1, code: 'bcdf', nickname: 'x' }),
    ) as Extract<ClientMsg, { type: 'room:join' }>;
    expect(m.code).toBe('BCDF');
  });

  it('accepts a real resolved shot event log', () => {
    const heights = new Float64Array(WORLD_W).fill(900);
    const tanks: SimTank[] = [
      { seat: 0, x: 500, y: 900, hp: 100, alive: true },
      { seat: 1, x: 1900, y: 900, hp: 100, alive: true },
    ];
    const out = resolveShot(
      { mask: TerrainMask.fromHeights(heights), tanks, wind: 40, seed: 7 },
      { seat: 0, weapon: 'mirvBounce', angleDeg: 60, power: 70 },
    );
    const msg: ClientMsg = {
      type: 'shot:fire',
      weapon: 'mirvBounce',
      angleDeci: 600,
      power: 70,
      events: out.events as never,
      ticks: Math.max(1, out.ticks),
    };
    const decoded = decodeClient(encode(msg));
    expect(decoded).not.toBeNull();
    expect((decoded as typeof msg).events.length).toBe(out.events.length);
  });
});

describe('server messages', () => {
  it('round-trips core lifecycle messages', () => {
    const msgs: ServerMsg[] = [
      { type: 'room:created', code: 'BCDF', seat: 0, token: 'a'.repeat(32), v: 1 },
      {
        type: 'turn:begin',
        seat: 1,
        turnNumber: 3,
        wind: -55,
        shotSeed: 12345,
      },
      { type: 'match:end', winner: null, reason: 'destroyed' },
      { type: 'error', code: 'ROOM_NOT_FOUND', msg: 'nope' },
    ];
    for (const m of msgs) expect(decodeServer(encode(m))).toEqual(m);
  });
});

describe('summarizeShotEvents', () => {
  it('agrees with the sim outcome', () => {
    const heights = new Float64Array(WORLD_W).fill(900);
    const tanks: SimTank[] = [
      { seat: 0, x: 500, y: 900, hp: 100, alive: true },
      { seat: 1, x: 640, y: 900, hp: 100, alive: true },
    ];
    const out = resolveShot(
      { mask: TerrainMask.fromHeights(heights), tanks, wind: 0, seed: 3 },
      { seat: 0, weapon: 'mortar', angleDeg: 4, power: 70 },
    );
    const summary = summarizeShotEvents(out.events, 0, [100, 100]);
    expect(summary.hp[1]).toBe(tanks[1].hp);
    expect(summary.hp[0]).toBe(tanks[0].hp);
    expect(summary.damageToOpponent).toBe(out.damageToOpponent);
    expect(summary.directHits).toBe(out.directHits);
    expect(summary.carves.length).toBeGreaterThan(0);
  });
});
