import {
  ANGLE_MAX,
  ANGLE_MIN,
  dequantAngle,
  hasAmmo,
  POWER_MAX,
  POWER_MIN,
  quantAngle,
  resolveShot,
  summarizeShotEvents,
  TerrainMask,
  type Inventory,
  type MatchConfig,
  type Seat,
  type ServerMsg,
  type SimEvent,
  type SimTank,
  type WeaponId,
} from '@mortar/shared';
import { useAppStore } from '../app/store';
import { sfx } from '../audio/sfx';
import type { GameApp } from '../game/GameApp';
import type { GameSession } from './GameSession';
import type { WsClient } from './wsClient';

interface AimState {
  angle: number;
  power: number;
}

/**
 * Online play: this client owns its local sim copy (terrain mask + tanks) and
 * the server referees. On our turn we resolve the shot locally and upload the
 * event log; on theirs we replay the log we receive. Both sides converge via
 * exact carve circles and server-authoritative HP/credits.
 */
export class NetworkSession implements GameSession {
  private mask: TerrainMask | null = null;
  private tanks: SimTank[] = [];
  private config: MatchConfig | null = null;
  private aims: [AimState, AimState] = [
    { angle: 60, power: 55 },
    { angle: 120, power: 55 },
  ];
  private myWeapon: WeaponId = 'mortar';
  private inventories: [Inventory, Inventory] = [{}, {}];
  private credits: [number, number] = [0, 0];
  private nicknames: [string, string] = ['Player 1', 'Player 2'];
  private turnSeat: Seat = 0;
  private turnNumber = 0;
  private wind = 0;
  private shotSeed = 0;
  private phase: 'idle' | 'loadout' | 'aim' | 'resolving' | 'end' = 'idle';
  private playbackActive = false;
  private queued: ServerMsg[] = [];
  private disposed = false;
  private unsubscribe: (() => void) | null = null;
  private aimSendTimer: ReturnType<typeof setTimeout> | null = null;
  private aimDirty = false;

  constructor(
    private readonly game: GameApp,
    private readonly ws: WsClient,
    readonly mySeat: Seat,
  ) {}

  get localSeat(): Seat {
    return this.mySeat;
  }

  start(): void {
    this.unsubscribe = this.ws.on((msg) => this.receive(msg));
  }

  /** Feed a message that arrived before this session subscribed. */
  deliver(msg: ServerMsg): void {
    this.receive(msg);
  }

  private receive(msg: ServerMsg): void {
    if (this.disposed) return;
    // Turn/match transitions wait for local playback to finish.
    if (this.playbackActive && (msg.type === 'turn:begin' || msg.type === 'match:end')) {
      this.queued.push(msg);
      return;
    }
    this.apply(msg);
  }

  private drainQueue(): void {
    while (!this.playbackActive && this.queued.length > 0) {
      this.apply(this.queued.shift()!);
    }
  }

  private apply(msg: ServerMsg): void {
    switch (msg.type) {
      case 'match:start':
        this.onMatchStart(msg);
        break;
      case 'room:snapshot':
        this.onSnapshot(msg);
        break;
      case 'shop:update':
        this.onShopUpdate(msg);
        break;
      case 'turn:begin':
        this.onTurnBegin(msg);
        break;
      case 'turn:aim':
        if (msg.seat !== this.mySeat && this.phase === 'aim') {
          const angle = dequantAngle(msg.angleDeci);
          this.aims[msg.seat] = { angle, power: msg.power };
          this.game.setAim(msg.seat, angle);
          useAppStore.setState({ aim: { angle, power: msg.power } });
        }
        break;
      case 'turn:selectWeapon':
        if (msg.seat !== this.mySeat) useAppStore.setState({ selectedWeapon: msg.weapon });
        break;
      case 'shot:resolved':
        this.onShotResolved(msg);
        break;
      case 'match:end':
        this.onMatchEnd(msg);
        break;
      case 'match:rematchState':
        useAppStore.setState({ rematchVotes: msg.votes });
        break;
      case 'room:peers': {
        useAppStore.setState({ peers: msg.peers });
        break;
      }
      case 'room:peerConnection':
        useAppStore.setState({ oppConnected: msg.connected });
        break;
      case 'room:closed':
        useAppStore.setState({ netError: `Room closed (${msg.reason}).` });
        break;
      case 'error':
        if (msg.code === 'VERSION_MISMATCH') {
          useAppStore.setState({ netError: msg.msg });
        }
        break;
      default:
        break;
    }
  }

  // ---- inbound handlers --------------------------------------------------

  private onMatchStart(msg: Extract<ServerMsg, { type: 'match:start' }>): void {
    this.config = msg.config;
    this.nicknames = msg.nicknames;
    this.phase = 'loadout';
    this.queued = [];
    this.playbackActive = false;
    this.game.onRoundLoaded = (info) => {
      if (this.disposed) return;
      this.mask = this.game.mask;
      this.tanks = info.spawnX.map((x, i) => ({
        seat: i as Seat,
        x,
        y: Math.round(info.heights[x]),
        hp: msg.config.startingHp,
        alive: true,
      }));
      this.game.setTanks(
        this.tanks.map((t) => ({ seat: t.seat, x: t.x, y: t.y, alive: t.alive })),
      );
      for (const t of this.tanks) this.game.setAim(t.seat, this.aims[t.seat].angle);
      this.pushStore();
    };
    this.game.loadRound(msg.matchSeed, msg.config.worldWidth);
  }

  /** Rebuild mid-match state after a reload or reconnect. */
  private onSnapshot(msg: Extract<ServerMsg, { type: 'room:snapshot' }>): void {
    this.config = msg.config;
    this.nicknames = msg.nicknames;
    this.credits = [msg.credits[0], msg.credits[1]];
    this.inventories = [msg.inventories[0] as Inventory, msg.inventories[1] as Inventory];
    this.turnSeat = msg.turnSeat;
    this.turnNumber = msg.turnNumber;
    this.wind = msg.wind;
    this.shotSeed = msg.shotSeed;
    this.phase =
      msg.phase === 'ended'
        ? 'end'
        : msg.phase === 'turn'
          ? 'aim'
          : msg.phase === 'resolving'
            ? 'resolving'
            : 'loadout';
    this.queued = [];
    this.playbackActive = false;

    this.game.onRoundLoaded = (info) => {
      if (this.disposed) return;
      this.mask = this.game.mask;
      // Terrain = seed + carve list; tank y only ever changes via falls.
      this.mask?.applyCarves(msg.carves);
      this.game.carveVisual(msg.carves);
      this.tanks = info.spawnX.map((x, i) => ({
        seat: i as Seat,
        x,
        y: msg.fallY[i] ?? Math.round(info.heights[x]),
        hp: msg.hp[i],
        alive: msg.hp[i] > 0,
      }));
      this.pushScene();
      this.pushStore();
      useAppStore.setState({ loadoutDone: msg.loadoutDone, oppConnected: true });
      if (this.phase === 'end') {
        useAppStore.setState({ matchPhase: 'end', winner: msg.winner, endReason: 'destroyed' });
      }
    };
    this.game.loadRound(msg.matchSeed, msg.config.worldWidth);
  }

  private onShopUpdate(msg: Extract<ServerMsg, { type: 'shop:update' }>): void {
    this.credits = [msg.credits[0], msg.credits[1]];
    this.inventories = [msg.inventories[0] as Inventory, msg.inventories[1] as Inventory];
    useAppStore.setState({
      inventories: [{ ...this.inventories[0] }, { ...this.inventories[1] }],
      loadoutDone: msg.loadoutDone,
      seats: [this.seatHud(0), this.seatHud(1)],
    });
  }

  private onTurnBegin(msg: Extract<ServerMsg, { type: 'turn:begin' }>): void {
    this.turnSeat = msg.seat;
    this.turnNumber = msg.turnNumber;
    this.wind = msg.wind;
    this.shotSeed = msg.shotSeed;
    this.phase = 'aim';
    if (!hasAmmo(this.inventories[this.mySeat], this.myWeapon)) this.myWeapon = 'mortar';
    sfx.turn();
    this.game.setWind(this.wind);
    this.pushScene();
    this.pushStore();
    useAppStore.setState({ shopOpen: false });
  }

  private onShotResolved(msg: Extract<ServerMsg, { type: 'shot:resolved' }>): void {
    this.credits = [msg.credits[0], msg.credits[1]];
    this.inventories = [msg.inventories[0] as Inventory, msg.inventories[1] as Inventory];
    const authoritativeHp: [number, number] = [msg.hp[0], msg.hp[1]];

    if (msg.seat === this.mySeat) {
      // Our own shot is already playing; just adopt the authoritative numbers
      // into the store when playback wraps (handled in finishShot).
      useAppStore.setState({
        inventories: [{ ...this.inventories[0] }, { ...this.inventories[1] }],
      });
      return;
    }

    // Opponent's shot: replay it. Carves apply to our mask as they land.
    this.phase = 'resolving';
    this.playbackActive = true;
    useAppStore.setState({ matchPhase: 'resolving', selectedWeapon: msg.weapon });
    const events = msg.events as SimEvent[];
    const startHp: [number, number] = [this.tanks[0].hp, this.tanks[1].hp];
    this.game.playShot(events, msg.seat, {
      onCarve: (circles) => this.mask?.applyCarves(circles),
      onDamage: (seat, _a, _d, hpAfter) => this.syncHpStore(seat, hpAfter),
      onFall: (seat, hpAfter) => this.syncHpStore(seat, hpAfter),
      onDone: () => {
        const summary = summarizeShotEvents(events, msg.seat, startHp);
        for (const t of this.tanks) {
          t.hp = authoritativeHp[t.seat];
          t.alive = authoritativeHp[t.seat] > 0;
          const fy = summary.fallY[t.seat];
          if (fy !== null) t.y = fy;
        }
        this.finishShot();
      },
    });
  }

  private onMatchEnd(msg: Extract<ServerMsg, { type: 'match:end' }>): void {
    this.phase = 'end';
    const iWon = msg.winner === this.mySeat;
    if (msg.winner === null || !iWon) sfx.lose();
    else sfx.win();
    useAppStore.setState({
      matchPhase: 'end',
      winner: msg.winner,
      rematchVotes: [false, false],
      seats: [this.seatHud(0), this.seatHud(1)],
      endReason: msg.reason,
    });
  }

  private finishShot(): void {
    this.playbackActive = false;
    this.game.setTanks(this.tanks.map((t) => ({ seat: t.seat, x: t.x, y: t.y, alive: t.alive })));
    useAppStore.setState({ seats: [this.seatHud(0), this.seatHud(1)] });
    this.drainQueue();
  }

  // ---- commands ----------------------------------------------------------

  aimBy(dAngle: number, dPower: number): void {
    if (this.phase !== 'aim' || this.turnSeat !== this.mySeat) return;
    const aim = this.aims[this.mySeat];
    this.setAim(aim.angle + dAngle, aim.power + dPower);
  }

  setAim(angleDeg: number, power: number): void {
    if (this.phase !== 'aim' || this.turnSeat !== this.mySeat) return;
    const aim = this.aims[this.mySeat];
    aim.angle = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, angleDeg));
    aim.power = Math.min(POWER_MAX, Math.max(POWER_MIN, power));
    this.game.setAim(this.mySeat, aim.angle);
    useAppStore.setState({ aim: { angle: aim.angle, power: aim.power } });
    this.scheduleAimSend();
  }

  /** Trailing throttle so the opponent's ghost barrel tracks smoothly. */
  private scheduleAimSend(): void {
    this.aimDirty = true;
    if (this.aimSendTimer) return;
    this.aimSendTimer = setTimeout(() => {
      this.aimSendTimer = null;
      if (!this.aimDirty || this.disposed) return;
      this.aimDirty = false;
      const aim = this.aims[this.mySeat];
      this.ws.send({
        type: 'turn:aim',
        angleDeci: quantAngle(aim.angle),
        power: Math.round(aim.power),
      });
    }, 120);
  }

  selectWeapon(id: WeaponId): void {
    if (this.phase !== 'aim' || this.turnSeat !== this.mySeat) return;
    if (!hasAmmo(this.inventories[this.mySeat], id)) return;
    this.myWeapon = id;
    useAppStore.setState({ selectedWeapon: id });
    this.ws.send({ type: 'turn:selectWeapon', weapon: id });
  }

  fire(): void {
    if (this.phase !== 'aim' || this.turnSeat !== this.mySeat || !this.mask) return;
    if (!hasAmmo(this.inventories[this.mySeat], this.myWeapon)) return;
    this.phase = 'resolving';
    const aim = this.aims[this.mySeat];

    const outcome = resolveShot(
      { mask: this.mask, tanks: this.tanks, wind: this.wind, seed: this.shotSeed },
      { seat: this.mySeat, weapon: this.myWeapon, angleDeg: aim.angle, power: aim.power },
    );
    this.ws.send({
      type: 'shot:fire',
      weapon: this.myWeapon,
      angleDeci: quantAngle(aim.angle),
      power: Math.round(aim.power),
      events: outcome.events as never,
      ticks: Math.max(1, outcome.ticks),
    });

    this.playbackActive = true;
    useAppStore.setState({ matchPhase: 'resolving' });
    this.game.playShot(outcome.events, this.mySeat, {
      onDamage: (seat, _a, _d, hpAfter) => this.syncHpStore(seat, hpAfter),
      onFall: (seat, hpAfter) => this.syncHpStore(seat, hpAfter),
      onDone: () => this.finishShot(),
    });
  }

  buy(weapon: WeaponId, qty = 1): void {
    if (this.phase !== 'loadout' && !(this.phase === 'aim' && this.turnSeat === this.mySeat)) {
      return;
    }
    this.ws.send({ type: 'shop:buy', weapon, qty });
  }

  loadoutReady(): void {
    if (this.phase !== 'loadout') return;
    sfx.uiTick();
    this.ws.send({ type: 'shop:ready' });
  }

  rematch(): void {
    this.ws.send({ type: 'match:rematch', accept: true });
  }

  leave(): void {
    this.ws.send({ type: 'room:leave' });
  }

  // ---- store/scene sync --------------------------------------------------

  private syncHpStore(seat: Seat, hpAfter: number): void {
    const seats = useAppStore.getState().seats;
    const next = [...seats] as typeof seats;
    next[seat] = { ...next[seat], hp: hpAfter, alive: hpAfter > 0 };
    useAppStore.setState({ seats: next });
  }

  private pushScene(): void {
    this.game.setTanks(this.tanks.map((t) => ({ seat: t.seat, x: t.x, y: t.y, alive: t.alive })));
    for (const t of this.tanks) this.game.setAim(t.seat, this.aims[t.seat].angle);
  }

  private pushStore(): void {
    const aim = this.aims[this.turnSeat];
    useAppStore.setState({
      matchActive: true,
      matchPhase: this.phase === 'idle' ? 'aim' : this.phase,
      turnSeat: this.turnSeat,
      loadoutSeat: this.phase === 'loadout' ? this.mySeat : null,
      turnNumber: this.turnNumber,
      wind: this.wind,
      seats: [this.seatHud(0), this.seatHud(1)],
      inventories: [{ ...this.inventories[0] }, { ...this.inventories[1] }],
      aim: { angle: aim.angle, power: aim.power },
      selectedWeapon: this.turnSeat === this.mySeat ? this.myWeapon : 'mortar',
      sandbox: false,
      aiSeat: null,
      mySeat: this.mySeat,
      winner: undefined,
    });
  }

  private seatHud(seat: Seat) {
    const t = this.tanks[seat];
    return {
      nickname: this.nicknames[seat],
      hp: t?.hp ?? this.config?.startingHp ?? 100,
      maxHp: this.config?.startingHp ?? 100,
      alive: t?.alive ?? true,
      credits: this.credits[seat],
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.aimSendTimer) clearTimeout(this.aimSendTimer);
    this.unsubscribe?.();
    this.game.onRoundLoaded = null;
  }
}
