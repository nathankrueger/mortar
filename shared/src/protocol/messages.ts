import { z } from 'zod';
import { MatchConfigSchema } from '../config';
import { WEAPONS, type WeaponId } from '../weapons';

// Wire protocol: JSON text frames over /ws, discriminated on `type`.
// Angles travel as deci-degrees (int), power as int — the rest is plain JSON.

export const WeaponIdSchema = z.custom<WeaponId>(
  (v) => typeof v === 'string' && v in WEAPONS,
  'unknown weapon',
);

const seat = z.union([z.literal(0), z.literal(1)]);
const nickname = z.string().trim().min(1).max(16);
const code = z
  .string()
  .length(4)
  .transform((s) => s.toUpperCase());
const token = z.string().length(32);
const angleDeci = z.number().int().min(20).max(1780);
const power = z.number().int().min(5).max(100);

// ---- Sim events (validated verbatim; produced by the shooter's engine) ----

export const SimEventSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('spawn'),
    id: z.number().int().min(1).max(500),
    kind: z.string().max(20),
    weapon: WeaponIdSchema,
    x: z.number(),
    y: z.number(),
    vx: z.number(),
    vy: z.number(),
    tick: z.number().int().min(0),
  }),
  z.object({
    t: z.literal('path'),
    id: z.number().int(),
    startTick: z.number().int(),
    stride: z.number().int().min(1).max(30),
    xs: z.array(z.number()).max(64),
    ys: z.array(z.number()).max(64),
  }),
  z.object({ t: z.literal('split'), id: z.number().int(), tick: z.number().int() }),
  z.object({
    t: z.literal('bounce'),
    id: z.number().int(),
    x: z.number(),
    y: z.number(),
    vx: z.number(),
    vy: z.number(),
    n: z.number().int(),
    tick: z.number().int(),
  }),
  z.object({
    t: z.literal('explode'),
    id: z.number().int(),
    x: z.number(),
    y: z.number(),
    r: z.number().min(1).max(400),
    tier: z.number().int().min(0).max(4),
    tick: z.number().int(),
  }),
  z.object({
    t: z.literal('carve'),
    circles: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          r: z.number().min(1).max(400),
          add: z.boolean().optional(),
        }),
      )
      .max(20),
    tick: z.number().int(),
  }),
  z.object({
    t: z.literal('fizzle'),
    id: z.number().int(),
    x: z.number(),
    y: z.number(),
    tick: z.number().int(),
  }),
  z.object({
    t: z.literal('damage'),
    seat,
    amount: z.number().min(0).max(200),
    direct: z.boolean(),
    hpAfter: z.number().min(0),
    tick: z.number().int(),
  }),
  z.object({
    t: z.literal('fall'),
    seat,
    x: z.number(),
    fromY: z.number(),
    toY: z.number(),
    dmg: z.number().min(0),
    hpAfter: z.number().min(0),
    tick: z.number().int(),
  }),
  z.object({ t: z.literal('die'), seat, tick: z.number().int() }),
]);

export type WireSimEvent = z.infer<typeof SimEventSchema>;

// ---- Client → Server ------------------------------------------------------

export const ClientMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('room:create'),
    v: z.number().int(),
    nickname,
    config: MatchConfigSchema.partial().optional(),
  }),
  z.object({ type: z.literal('room:join'), v: z.number().int(), code, nickname }),
  z.object({ type: z.literal('room:rejoin'), v: z.number().int(), code, token }),
  z.object({ type: z.literal('room:leave') }),
  z.object({ type: z.literal('lobby:ready'), ready: z.boolean() }),
  z.object({ type: z.literal('shop:buy'), weapon: WeaponIdSchema, qty: z.number().int().min(1).max(9) }),
  z.object({ type: z.literal('shop:ready') }),
  z.object({ type: z.literal('turn:aim'), angleDeci, power }),
  z.object({ type: z.literal('turn:selectWeapon'), weapon: WeaponIdSchema }),
  z.object({
    type: z.literal('shot:fire'),
    weapon: WeaponIdSchema,
    angleDeci,
    power,
    events: z.array(SimEventSchema).max(4000),
    ticks: z.number().int().min(1).max(2400),
  }),
  z.object({ type: z.literal('match:rematch'), accept: z.boolean() }),
  z.object({ type: z.literal('pong') }),
]);

export type ClientMsg = z.infer<typeof ClientMsgSchema>;

// ---- Server → Client ------------------------------------------------------

const peerInfo = z.object({
  nickname,
  connected: z.boolean(),
  ready: z.boolean(),
});

const seatsNumbers = z.tuple([z.number(), z.number()]);
const inventories = z.tuple([z.record(z.string(), z.number()), z.record(z.string(), z.number())]);

export const ServerMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('room:created'),
    code: z.string(),
    seat,
    token,
    v: z.number().int(),
  }),
  z.object({
    type: z.literal('room:joined'),
    code: z.string(),
    seat,
    token,
    v: z.number().int(),
  }),
  z.object({ type: z.literal('room:peers'), peers: z.array(peerInfo).length(2).or(z.array(peerInfo).length(1)) }),
  z.object({
    type: z.literal('match:start'),
    matchSeed: z.number().int(),
    config: MatchConfigSchema,
    firstSeat: seat,
    nicknames: z.tuple([nickname, nickname]),
  }),
  z.object({
    type: z.literal('shop:update'),
    credits: seatsNumbers,
    inventories,
    loadoutDone: z.tuple([z.boolean(), z.boolean()]),
  }),
  z.object({
    type: z.literal('turn:begin'),
    seat,
    turnNumber: z.number().int(),
    wind: z.number(),
    shotSeed: z.number().int(),
  }),
  z.object({ type: z.literal('turn:aim'), seat, angleDeci, power }),
  z.object({ type: z.literal('turn:selectWeapon'), seat, weapon: WeaponIdSchema }),
  z.object({
    type: z.literal('shot:resolved'),
    seat,
    weapon: WeaponIdSchema,
    angleDeci,
    power,
    events: z.array(SimEventSchema).max(4000),
    ticks: z.number().int(),
    hp: seatsNumbers,
    credits: seatsNumbers,
    inventories,
  }),
  z.object({
    type: z.literal('match:end'),
    winner: seat.nullable(),
    reason: z.enum(['destroyed', 'forfeit']),
  }),
  z.object({ type: z.literal('match:rematchState'), votes: z.tuple([z.boolean(), z.boolean()]) }),
  z.object({
    type: z.literal('room:snapshot'),
    phase: z.enum(['lobby', 'loadout', 'turn', 'resolving', 'ended']),
    config: MatchConfigSchema,
    matchSeed: z.number().int(),
    firstSeat: seat,
    nicknames: z.tuple([nickname, nickname]),
    turnSeat: seat,
    turnNumber: z.number().int(),
    wind: z.number(),
    shotSeed: z.number().int(),
    hp: seatsNumbers,
    credits: seatsNumbers,
    inventories,
    loadoutDone: z.tuple([z.boolean(), z.boolean()]),
    carves: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          r: z.number(),
          add: z.boolean().optional(),
        }),
      )
      .max(5000),
    fallY: z.tuple([z.number().nullable(), z.number().nullable()]),
    winner: seat.nullable(),
  }),
  z.object({ type: z.literal('room:peerConnection'), seat, connected: z.boolean() }),
  z.object({ type: z.literal('room:closed'), reason: z.enum(['expired', 'opponentLeft', 'serverShutdown']) }),
  z.object({
    type: z.literal('error'),
    code: z.enum([
      'ROOM_NOT_FOUND',
      'ROOM_FULL',
      'BAD_TOKEN',
      'BAD_PHASE',
      'NOT_YOUR_TURN',
      'INSUFFICIENT_FUNDS',
      'NO_AMMO',
      'RATE_LIMITED',
      'VERSION_MISMATCH',
      'BAD_MESSAGE',
    ]),
    msg: z.string().max(200),
  }),
  z.object({ type: z.literal('ping') }),
]);

export type ServerMsg = z.infer<typeof ServerMsgSchema>;

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const parsed = ClientMsgSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const parsed = ServerMsgSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
