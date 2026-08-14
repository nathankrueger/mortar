import {
  applyPurchase,
  checkPurchase,
  consumeAmmo,
  driftWind,
  hasAmmo,
  PROTOCOL_VERSION,
  resolveConfig,
  shotEarnings,
  summarizeShotEvents,
  TICK_HZ,
  type CarveCircle,
  type ClientMsg,
  type Inventory,
  type MatchConfig,
  type Seat,
  type ServerMsg,
  type SimEvent,
  type WeaponId,
} from '@mortar/shared';
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';

interface SeatState {
  ws: WebSocket | null;
  nickname: string;
  /** Requested tank color (palette index); null = random each match. */
  colorPick: number | null;
  token: string;
  lobbyReady: boolean;
  loadoutDone: boolean;
  credits: number;
  inventory: Inventory;
  hp: number;
  alive: boolean;
  rematchVote: boolean;
  lastAimAt: number;
  /** Resting y from the last fall event (rejoin snapshots, M7). */
  fallY: number | null;
}

type Phase = 'lobby' | 'loadout' | 'turn' | 'resolving' | 'ended';

const rand32 = (): number => randomBytes(4).readUInt32BE(0);

/**
 * One match room. The server is referee and relay: it validates phases,
 * turn order, and purchases, rolls wind + shot seeds, and tracks HP/credits
 * by replaying event summaries — it never simulates physics.
 */
export class Room {
  readonly code: string;
  config: MatchConfig;
  phase: Phase = 'lobby';
  seats: (SeatState | null)[] = [null, null];
  turnSeat: Seat = 0;
  turnNumber = 0;
  matchSeed = 0;
  firstSeat: Seat = 0;
  wind = 0;
  shotSeed = 0;
  winner: Seat | null = null;
  carves: CarveCircle[] = [];
  lastActivity = Date.now();
  private nextTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private forfeitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, config?: unknown) {
    this.code = code;
    this.config = resolveConfig(config);
  }

  // ---- membership -------------------------------------------------------

  addPlayer(
    ws: WebSocket,
    nickname: string,
    colorPick: number | null = null,
  ): { seat: Seat; token: string } | 'full' {
    const idx = this.seats.findIndex((s) => s === null);
    if (idx === -1 || this.phase !== 'lobby') return 'full';
    const token = randomBytes(16).toString('hex');
    this.seats[idx] = {
      ws,
      nickname,
      colorPick,
      token,
      lobbyReady: false,
      loadoutDone: false,
      credits: 0,
      inventory: {},
      hp: 0,
      alive: true,
      rematchVote: false,
      lastAimAt: 0,
      fallY: null,
    };
    this.touch();
    this.broadcastPeers();
    return { seat: idx as Seat, token };
  }

  rejoin(ws: WebSocket, token: string): Seat | 'bad-token' {
    const idx = this.seats.findIndex((s) => s?.token === token);
    if (idx === -1) return 'bad-token';
    const seat = this.seats[idx]!;
    seat.ws?.close();
    seat.ws = ws;
    this.touch();
    this.broadcast({ type: 'room:peerConnection', seat: idx as Seat, connected: true });
    if (this.forfeitTimer && this.bothConnected()) {
      clearTimeout(this.forfeitTimer);
      this.forfeitTimer = null;
    }
    return idx as Seat;
  }

  onDisconnect(seat: Seat): void {
    const s = this.seats[seat];
    if (!s) return;
    s.ws = null;
    this.touch();
    if (this.phase === 'lobby') {
      // Hold the seat (ready flag included) — a backgrounded phone drops its
      // socket but usually comes back. Free it only after a grace window.
      this.broadcastPeers();
      setTimeout(() => {
        if (this.phase === 'lobby' && this.seats[seat] && this.seats[seat]!.ws === null) {
          this.seats[seat] = null;
          this.broadcastPeers();
        }
      }, 120_000);
      return;
    }
    this.broadcast({ type: 'room:peerConnection', seat, connected: false });
    if (!this.forfeitTimer) {
      // Mid-match: long grace, then forfeit. After the match: a short window —
      // if they don't return, any pending rematch offer is dead and the
      // survivor shouldn't wait on it.
      this.forfeitTimer =
        this.phase !== 'ended'
          ? setTimeout(() => this.forfeit(seat), 180_000)
          : setTimeout(() => this.abandonAfterEnd(seat), 60_000);
    }
  }

  /** Opponent never came back after the match ended: close out the room. */
  private abandonAfterEnd(gone: Seat): void {
    this.forfeitTimer = null;
    if (this.phase !== 'ended' || this.seats[gone]?.ws) return; // rejoined
    this.send((1 - gone) as Seat, { type: 'room:closed', reason: 'opponentLeft' });
    this.seats[gone] = null;
  }

  /** Full mid-match state for a rejoining client. */
  sendSnapshot(seat: Seat): void {
    if (this.phase === 'lobby' || !this.bothSeated()) return;
    this.send(seat, {
      type: 'room:snapshot',
      phase: this.phase,
      config: this.config,
      matchSeed: this.matchSeed,
      firstSeat: this.firstSeat,
      nicknames: [this.seats[0]!.nickname, this.seats[1]!.nickname],
      colors: [this.seats[0]!.colorPick, this.seats[1]!.colorPick],
      turnSeat: this.turnSeat,
      turnNumber: this.turnNumber,
      wind: this.wind,
      shotSeed: this.shotSeed,
      hp: [this.seats[0]!.hp, this.seats[1]!.hp],
      credits: [this.seats[0]!.credits, this.seats[1]!.credits],
      inventories: [
        this.seats[0]!.inventory as Record<string, number>,
        this.seats[1]!.inventory as Record<string, number>,
      ],
      loadoutDone: [this.seats[0]!.loadoutDone, this.seats[1]!.loadoutDone],
      carves: this.carves,
      fallY: [this.seats[0]!.fallY, this.seats[1]!.fallY],
      winner: this.winner,
    });
  }

  get empty(): boolean {
    return this.seats.every((s) => s === null || s.ws === null);
  }

  private bothConnected(): boolean {
    return this.seats.every((s) => s !== null && s.ws !== null);
  }

  private bothSeated(): boolean {
    return this.seats.every((s) => s !== null);
  }

  // ---- messaging --------------------------------------------------------

  send(seat: Seat, msg: ServerMsg): void {
    const ws = this.seats[seat]?.ws;
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg): void {
    this.send(0, msg);
    this.send(1, msg);
  }

  broadcastPeers(): void {
    const peers = this.seats.flatMap((s, i) =>
      s
        ? [
            {
              seat: i as Seat,
              nickname: s.nickname,
              connected: s.ws !== null,
              ready: s.lobbyReady,
            },
          ]
        : [],
    );
    this.broadcast({ type: 'room:peers', peers });
  }

  private error(seat: Seat, code: Extract<ServerMsg, { type: 'error' }>['code'], msg: string): void {
    this.send(seat, { type: 'error', code, msg });
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  // ---- message dispatch -------------------------------------------------

  handleMsg(seat: Seat, msg: ClientMsg): void {
    this.touch();
    switch (msg.type) {
      case 'lobby:ready':
        this.onLobbyReady(seat, msg.ready);
        break;
      case 'shop:buy':
        this.onBuy(seat, msg.weapon, msg.qty);
        break;
      case 'shop:ready':
        this.onShopReady(seat);
        break;
      case 'turn:aim':
        this.onAim(seat, msg.angleDeci, msg.power);
        break;
      case 'turn:selectWeapon':
        this.onSelectWeapon(seat, msg.weapon);
        break;
      case 'shot:fire':
        this.onFire(seat, msg);
        break;
      case 'match:rematch':
        this.onRematch(seat, msg.accept);
        break;
      case 'room:leave':
        this.onLeave(seat);
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }

  // ---- lobby ------------------------------------------------------------

  private onLobbyReady(seat: Seat, ready: boolean): void {
    if (this.phase !== 'lobby') return;
    const s = this.seats[seat];
    if (!s) return;
    s.lobbyReady = ready;
    this.broadcastPeers();
    if (this.bothSeated() && this.seats.every((x) => x!.lobbyReady)) this.startMatch();
  }

  private startMatch(): void {
    this.matchSeed = rand32();
    this.firstSeat = Math.random() < 0.5 ? 0 : 1;
    this.phase = 'loadout';
    this.turnNumber = 0;
    this.wind = 0; // calm start; drifts a little each turn
    this.winner = null;
    this.carves = [];
    for (const s of this.seats) {
      if (!s) continue;
      s.credits = this.config.startingCredits;
      s.inventory = {};
      s.hp = this.config.startingHp;
      s.alive = true;
      s.loadoutDone = false;
      s.rematchVote = false;
      s.fallY = null;
    }
    this.broadcast({
      type: 'match:start',
      matchSeed: this.matchSeed,
      config: this.config,
      firstSeat: this.firstSeat,
      nicknames: [this.seats[0]!.nickname, this.seats[1]!.nickname],
      colors: [this.seats[0]!.colorPick, this.seats[1]!.colorPick],
    });
    this.broadcastShop();
  }

  private broadcastShop(): void {
    this.broadcast({
      type: 'shop:update',
      credits: [this.seats[0]!.credits, this.seats[1]!.credits],
      inventories: [
        this.seats[0]!.inventory as Record<string, number>,
        this.seats[1]!.inventory as Record<string, number>,
      ],
      loadoutDone: [this.seats[0]!.loadoutDone, this.seats[1]!.loadoutDone],
    });
  }

  // ---- shop -------------------------------------------------------------

  private onBuy(seat: Seat, weapon: WeaponId, qty: number): void {
    const s = this.seats[seat];
    if (!s) return;
    const inLoadout = this.phase === 'loadout' && !s.loadoutDone;
    const inOwnTurn = this.phase === 'turn' && seat === this.turnSeat;
    if (!inLoadout && !inOwnTurn) {
      this.error(seat, 'BAD_PHASE', 'cannot shop right now');
      return;
    }
    const check = checkPurchase(s.credits, weapon, qty);
    if (!check.ok) {
      this.error(seat, 'INSUFFICIENT_FUNDS', check.reason ?? 'purchase rejected');
      return;
    }
    const applied = applyPurchase(s.credits, s.inventory, weapon, qty);
    s.credits = applied.credits;
    s.inventory = applied.inv;
    this.broadcastShop();
  }

  private onShopReady(seat: Seat): void {
    if (this.phase !== 'loadout') return;
    const s = this.seats[seat];
    if (!s) return;
    s.loadoutDone = true;
    this.broadcastShop();
    if (this.seats.every((x) => x!.loadoutDone)) this.beginTurn(this.firstSeat);
  }

  // ---- turns ------------------------------------------------------------

  private beginTurn(seat: Seat): void {
    this.phase = 'turn';
    this.turnSeat = seat;
    this.turnNumber++;
    this.wind = driftWind(this.wind, () => Math.random(), this.config.windMax);
    this.shotSeed = rand32();
    this.seats[seat]!.credits += this.config.turnAllowance; // per-turn stipend
    this.broadcast({
      type: 'turn:begin',
      seat,
      turnNumber: this.turnNumber,
      wind: this.wind,
      shotSeed: this.shotSeed,
    });
    this.broadcastShop(); // carries the refreshed credits to both clients
  }

  private onAim(seat: Seat, angleDeci: number, power: number): void {
    if (this.phase !== 'turn' || seat !== this.turnSeat) return;
    const s = this.seats[seat];
    if (!s) return;
    const now = Date.now();
    if (now - s.lastAimAt < 60) return; // rate cap ~16/s
    s.lastAimAt = now;
    this.send((1 - seat) as Seat, { type: 'turn:aim', seat, angleDeci, power });
  }

  private onSelectWeapon(seat: Seat, weapon: WeaponId): void {
    if (this.phase !== 'turn' || seat !== this.turnSeat) return;
    this.send((1 - seat) as Seat, { type: 'turn:selectWeapon', seat, weapon });
  }

  private onFire(seat: Seat, msg: Extract<ClientMsg, { type: 'shot:fire' }>): void {
    if (this.phase !== 'turn' || seat !== this.turnSeat) {
      this.error(seat, 'NOT_YOUR_TURN', 'not your turn');
      return;
    }
    const s = this.seats[seat]!;
    if (!hasAmmo(s.inventory, msg.weapon)) {
      this.error(seat, 'NO_AMMO', `no ${msg.weapon} left`);
      return;
    }
    s.inventory = consumeAmmo(s.inventory, msg.weapon);
    this.phase = 'resolving';

    const summary = summarizeShotEvents(
      msg.events as SimEvent[],
      seat,
      [this.seats[0]!.hp, this.seats[1]!.hp],
    );
    this.seats[0]!.hp = summary.hp[0];
    this.seats[1]!.hp = summary.hp[1];
    this.seats[0]!.alive = summary.alive[0] && summary.hp[0] > 0;
    this.seats[1]!.alive = summary.alive[1] && summary.hp[1] > 0;
    if (summary.fallY[0] !== null) this.seats[0]!.fallY = summary.fallY[0];
    if (summary.fallY[1] !== null) this.seats[1]!.fallY = summary.fallY[1];
    this.carves.push(...summary.carves);
    s.credits += shotEarnings(summary.damageToOpponent, summary.directHits);

    this.broadcast({
      type: 'shot:resolved',
      seat,
      weapon: msg.weapon,
      angleDeci: msg.angleDeci,
      power: msg.power,
      events: msg.events,
      ticks: msg.ticks,
      hp: [this.seats[0]!.hp, this.seats[1]!.hp],
      credits: [this.seats[0]!.credits, this.seats[1]!.credits],
      inventories: [
        this.seats[0]!.inventory as Record<string, number>,
        this.seats[1]!.inventory as Record<string, number>,
      ],
    });

    // Let playback finish on both clients, then advance.
    const playbackMs = (msg.ticks / TICK_HZ) * 1000 + 2000;
    this.nextTurnTimer = setTimeout(() => {
      this.nextTurnTimer = null;
      const dead = this.seats.filter((x) => x && !x.alive).length;
      if (dead > 0) {
        this.endMatch(
          dead === 2 ? null : this.seats[0]!.alive ? 0 : 1,
          'destroyed',
        );
      } else {
        this.beginTurn((1 - seat) as Seat);
      }
    }, playbackMs);
  }

  private endMatch(winner: Seat | null, reason: 'destroyed' | 'forfeit'): void {
    this.phase = 'ended';
    this.winner = winner;
    this.broadcast({ type: 'match:end', winner, reason });
  }

  private forfeit(gone: Seat): void {
    if (this.phase === 'ended' || this.phase === 'lobby') return;
    this.endMatch((1 - gone) as Seat, 'forfeit');
  }

  private onRematch(seat: Seat, accept: boolean): void {
    if (this.phase !== 'ended') return;
    const s = this.seats[seat];
    if (!s) return;
    s.rematchVote = accept;
    this.broadcast({
      type: 'match:rematchState',
      votes: [this.seats[0]?.rematchVote ?? false, this.seats[1]?.rematchVote ?? false],
    });
    if (this.bothSeated() && this.seats.every((x) => x!.rematchVote)) this.startMatch();
  }

  private onLeave(seat: Seat): void {
    const other = (1 - seat) as Seat;
    if (this.phase !== 'ended' && this.phase !== 'lobby') {
      this.endMatch(other, 'forfeit');
    } else if (this.phase === 'ended') {
      // Walking out on the end screen kills any rematch offer immediately.
      this.send(other, { type: 'room:closed', reason: 'opponentLeft' });
    }
    this.seats[seat]?.ws?.close();
    this.seats[seat] = null;
    if (this.phase === 'lobby') this.broadcastPeers();
  }

  dispose(): void {
    if (this.nextTurnTimer) clearTimeout(this.nextTurnTimer);
    if (this.forfeitTimer) clearTimeout(this.forfeitTimer);
    this.broadcast({ type: 'room:closed', reason: 'expired' });
    for (const s of this.seats) s?.ws?.close();
  }

  // ---- persistence across server restarts --------------------------------
  // Rooms are tiny; serializing them lets a deploy/restart look like a brief
  // network blip — clients auto-rejoin by token and get a snapshot.

  toJSON(): unknown {
    return {
      code: this.code,
      config: this.config,
      phase: this.phase,
      turnSeat: this.turnSeat,
      turnNumber: this.turnNumber,
      matchSeed: this.matchSeed,
      firstSeat: this.firstSeat,
      wind: this.wind,
      shotSeed: this.shotSeed,
      winner: this.winner,
      carves: this.carves,
      seats: this.seats.map((s) =>
        s
          ? {
              nickname: s.nickname,
              colorPick: s.colorPick,
              token: s.token,
              lobbyReady: s.lobbyReady,
              loadoutDone: s.loadoutDone,
              credits: s.credits,
              inventory: s.inventory,
              hp: s.hp,
              alive: s.alive,
              fallY: s.fallY,
            }
          : null,
      ),
    };
  }

  static fromJSON(data: ReturnType<Room['toJSON']>): Room {
    const d = data as Room & { seats: (SeatState | null)[] };
    const room = new Room(d.code, d.config);
    room.phase = d.phase;
    room.turnSeat = d.turnSeat;
    room.turnNumber = d.turnNumber;
    room.matchSeed = d.matchSeed;
    room.firstSeat = d.firstSeat;
    room.wind = d.wind;
    room.shotSeed = d.shotSeed;
    room.winner = d.winner;
    room.carves = d.carves ?? [];
    room.seats = d.seats.map((s) =>
      s
        ? {
            ws: null,
            nickname: s.nickname,
            colorPick: s.colorPick ?? null,
            token: s.token,
            lobbyReady: s.lobbyReady,
            loadoutDone: s.loadoutDone,
            credits: s.credits,
            inventory: s.inventory,
            hp: s.hp,
            alive: s.alive,
            rematchVote: false,
            lastAimAt: 0,
            fallY: s.fallY,
          }
        : null,
    );
    room.scheduleRestoreTimers();
    return room;
  }

  /** After a restore nobody is connected; restart the lifecycle timers. */
  private scheduleRestoreTimers(): void {
    // A restart mid-resolution lost the next-turn timer: advance shortly.
    if (this.phase === 'resolving') {
      this.nextTurnTimer = setTimeout(() => {
        this.nextTurnTimer = null;
        const dead = this.seats.filter((x) => x && !x.alive).length;
        if (dead > 0) {
          this.endMatch(dead === 2 ? null : this.seats[0]!.alive ? 0 : 1, 'destroyed');
        } else {
          this.beginTurn((1 - this.turnSeat) as Seat);
        }
      }, 5_000);
    }
    // Players who never come back forfeit as usual.
    if (this.phase === 'turn' || this.phase === 'resolving') {
      for (const [i, s] of this.seats.entries()) {
        if (!s) continue;
        setTimeout(() => {
          if (this.phase !== 'ended' && this.seats[i] && this.seats[i]!.ws === null) {
            this.forfeit(i as Seat);
          }
        }, 180_000);
      }
    }
  }
}

export { PROTOCOL_VERSION };
