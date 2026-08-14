import {
  AI_PROFILES,
  ANGLE_MAX,
  ANGLE_MIN,
  applyPurchase,
  checkPurchase,
  consumeAmmo,
  DEFAULT_CONFIG,
  deriveSeed,
  driftWind,
  hasAmmo,
  mulberry32,
  pickWeapon,
  planPurchases,
  planShot,
  POWER_MAX,
  POWER_MIN,
  resolveShot,
  shotEarnings,
  TerrainMask,
  type AiDifficulty,
  type ColorPick,
  type Inventory,
  type MatchConfig,
  type Seat,
  type SimTank,
  type WeaponId,
} from '@mortar/shared';
import { useAppStore } from '../app/store';
import { sfx } from '../audio/sfx';
import type { GameApp } from '../game/GameApp';
import type { GameSession } from './GameSession';

interface AimState {
  angle: number;
  power: number;
}

export interface LocalSessionOptions {
  sandbox?: boolean;
  ai?: { seat: Seat; difficulty: AiDifficulty };
  /** Requested tank colors per seat (null = random each match). */
  colorPicks?: [ColorPick, ColorPick];
}

const WIND_SALT = 0x51a7;

/**
 * Runs a full match on this machine: hotseat duel, sandbox firing range, or
 * human vs AI. Owns the sim-truth terrain mask, tanks, credits, and
 * inventories; the GameApp renders what this session tells it to.
 */
export class LocalSession implements GameSession {
  private mask: TerrainMask | null = null;
  private tanks: SimTank[] = [];
  private aims: [AimState, AimState] = [
    { angle: 60, power: 55 },
    { angle: 120, power: 55 },
  ];
  private weapons: [WeaponId, WeaponId] = ['mortar', 'mortar'];
  private credits: [number, number] = [0, 0];
  private inventories: [Inventory, Inventory] = [{}, {}];
  private turnSeat: Seat = 0;
  private firstSeat: Seat = 0;
  private turnNumber = 0;
  private wind = 0;
  private phase: 'loadout' | 'aim' | 'resolving' | 'end' = 'loadout';
  private loadoutSeat: Seat = 0;
  private disposed = false;
  private aiSignal: { cancelled: boolean } | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private aimAnimator: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly game: GameApp,
    private readonly matchSeed: number,
    private readonly config: MatchConfig = DEFAULT_CONFIG,
    private readonly nicknames: [string, string] = ['Player 1', 'Player 2'],
    private readonly options: LocalSessionOptions = {},
  ) {}

  get localSeat(): Seat {
    return this.phase === 'loadout' ? this.loadoutSeat : this.turnSeat;
  }

  get isSandbox(): boolean {
    return this.options.sandbox === true;
  }

  private isAiSeat(seat: Seat): boolean {
    return this.options.ai?.seat === seat;
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      if (!this.disposed) fn();
    }, ms);
    this.timers.push(t);
  }

  start(): void {
    const game = this.game;
    this.credits = [this.config.startingCredits, this.config.startingCredits];
    this.inventories = [{}, {}];
    game.onRoundLoaded = (info) => {
      if (this.disposed) return;
      this.mask = game.mask; // share one mask: sim carves it, renderer mirrors
      this.tanks = info.spawnX.map((x, i) => ({
        seat: i as Seat,
        x,
        y: Math.round(info.heights[x]),
        hp: this.config.startingHp,
        alive: true,
      }));
      const rng = mulberry32(deriveSeed(this.matchSeed, 1));
      this.firstSeat = rng() < 0.5 ? 0 : 1;
      this.turnNumber = 0;
      this.pushScene();
      if (this.options.sandbox) {
        this.turnSeat = this.firstSeat;
        this.beginTurn();
      } else {
        this.phase = 'loadout';
        this.loadoutSeat = 0;
        this.pushStore();
        this.maybeRunAiLoadout();
      }
    };
    game.setColorPicks(this.options.colorPicks ?? [null, null]);
    game.loadRound(this.matchSeed, this.config.worldWidth);
  }

  // ---- Loadout ----------------------------------------------------------

  loadoutReady(): void {
    if (this.phase !== 'loadout' || this.isAiSeat(this.loadoutSeat)) return;
    sfx.uiTick();
    this.advanceLoadout();
  }

  private advanceLoadout(): void {
    if (this.loadoutSeat === 0) {
      this.loadoutSeat = 1;
      this.pushStore();
      this.maybeRunAiLoadout();
      return;
    }
    this.turnSeat = this.firstSeat;
    this.beginTurn();
  }

  private maybeRunAiLoadout(): void {
    if (this.phase !== 'loadout' || !this.isAiSeat(this.loadoutSeat)) return;
    const seat = this.loadoutSeat;
    this.later(600, () => {
      for (const p of planPurchases(this.credits[seat], this.options.ai!.difficulty)) {
        const applied = applyPurchase(this.credits[seat], this.inventories[seat], p.weapon, p.qty);
        this.credits[seat] = applied.credits;
        this.inventories[seat] = applied.inv;
      }
      this.pushStore();
      this.later(400, () => this.advanceLoadout());
    });
  }

  buy(weapon: WeaponId, qty = 1): void {
    if (this.phase !== 'loadout' && this.phase !== 'aim') return;
    const seat = this.localSeat;
    if (this.isAiSeat(seat)) return;
    this.buyFor(seat, weapon, qty);
  }

  private buyFor(seat: Seat, weapon: WeaponId, qty: number): void {
    const check = checkPurchase(this.credits[seat], weapon, qty);
    if (!check.ok) return;
    const applied = applyPurchase(this.credits[seat], this.inventories[seat], weapon, qty);
    this.credits[seat] = applied.credits;
    this.inventories[seat] = applied.inv;
    sfx.uiTick();
    this.pushStore();
  }

  // ---- Turn flow --------------------------------------------------------

  private beginTurn(): void {
    this.turnNumber++;
    const windRng = mulberry32(deriveSeed(this.matchSeed, WIND_SALT + this.turnNumber));
    this.wind = driftWind(this.wind, windRng, this.config.windMax);
    const seat = this.turnSeat;
    this.credits[seat] += this.config.turnAllowance; // per-turn stipend
    if (!this.isSandbox && !hasAmmo(this.inventories[seat], this.weapons[seat])) {
      this.weapons[seat] = 'mortar';
    }
    this.phase = 'aim';
    sfx.turn();
    this.game.setWind(this.wind);
    this.pushScene();
    this.pushStore();
    useAppStore.setState({ shopOpen: false });
    if (this.isAiSeat(seat)) {
      const [lo, hi] = AI_PROFILES[this.options.ai!.difficulty].thinkMs;
      this.later(lo + Math.random() * (hi - lo), () => void this.runAiTurn());
    }
  }

  private currentShotSeed(): number {
    return deriveSeed(this.matchSeed, 7000 + this.turnNumber);
  }

  private async runAiTurn(): Promise<void> {
    if (this.phase !== 'aim' || !this.mask) return;
    const seat = this.turnSeat;
    if (!this.isAiSeat(seat)) return;
    const difficulty = this.options.ai!.difficulty;

    // Occasional mid-match shopping: top up with the best affordable nuke.
    if (difficulty !== 'easy') {
      for (const w of ['medNuke', 'smallNuke'] as WeaponId[]) {
        if ((this.inventories[seat][w] ?? 0) === 0 && checkPurchase(this.credits[seat], w, 1).ok) {
          this.buyFor(seat, w, 1);
          break;
        }
      }
    }

    const weapon = pickWeapon(this.inventories[seat], difficulty, hasAmmo);
    this.weapons[seat] = weapon;
    useAppStore.setState({ selectedWeapon: weapon });

    this.aiSignal = { cancelled: false };
    const plan = await planShot(
      {
        mask: this.mask,
        tanks: this.tanks,
        wind: this.wind,
        shotSeed: this.currentShotSeed(),
        seat,
      },
      weapon,
      difficulty,
      { signal: this.aiSignal },
    );
    if (this.disposed || this.phase !== 'aim' || this.turnSeat !== seat) return;

    await this.animateAimTo(seat, plan.angleDeg, plan.power);
    if (this.disposed || this.phase !== 'aim' || this.turnSeat !== seat) return;
    this.doFire();
  }

  /** Sweep the barrel to the solution so the AI visibly "aims". */
  private animateAimTo(seat: Seat, angle: number, power: number): Promise<void> {
    return new Promise((resolve) => {
      const aim = this.aims[seat];
      const from = { ...aim };
      const steps = 20;
      let i = 0;
      this.aimAnimator = setInterval(() => {
        i++;
        const f = i / steps;
        const ease = f * f * (3 - 2 * f);
        aim.angle = from.angle + (angle - from.angle) * ease;
        aim.power = from.power + (power - from.power) * ease;
        this.game.setAim(seat, aim.angle);
        useAppStore.setState({ aim: { angle: aim.angle, power: aim.power } });
        if (i >= steps || this.disposed) {
          clearInterval(this.aimAnimator!);
          this.aimAnimator = null;
          resolve();
        }
      }, 36);
    });
  }

  // ---- Human commands ---------------------------------------------------

  aimBy(dAngle: number, dPower: number): void {
    if (this.phase !== 'aim' || this.isAiSeat(this.turnSeat)) return;
    const aim = this.aims[this.turnSeat];
    this.setAim(aim.angle + dAngle, aim.power + dPower);
  }

  setAim(angleDeg: number, power: number): void {
    if (this.phase !== 'aim' || this.isAiSeat(this.turnSeat)) return;
    const aim = this.aims[this.turnSeat];
    aim.angle = Math.min(ANGLE_MAX, Math.max(ANGLE_MIN, angleDeg));
    aim.power = Math.min(POWER_MAX, Math.max(POWER_MIN, power));
    this.game.setAim(this.turnSeat, aim.angle);
    useAppStore.setState({ aim: { angle: aim.angle, power: aim.power } });
  }

  selectWeapon(id: WeaponId): void {
    if (this.phase !== 'aim' || this.isAiSeat(this.turnSeat)) return;
    if (!this.isSandbox && !hasAmmo(this.inventories[this.turnSeat], id)) return;
    this.weapons[this.turnSeat] = id;
    useAppStore.setState({ selectedWeapon: id });
  }

  fire(): void {
    if (this.isAiSeat(this.turnSeat)) return;
    this.doFire();
  }

  // ---- Shot resolution --------------------------------------------------

  private doFire(): void {
    if (this.phase !== 'aim' || !this.mask) return;
    const seat = this.turnSeat;
    const weapon = this.weapons[seat];
    if (!this.isSandbox) {
      if (!hasAmmo(this.inventories[seat], weapon)) return;
      this.inventories[seat] = consumeAmmo(this.inventories[seat], weapon);
    }
    this.phase = 'resolving';
    const aim = this.aims[seat];

    const outcome = resolveShot(
      { mask: this.mask, tanks: this.tanks, wind: this.wind, seed: this.currentShotSeed() },
      { seat, weapon, angleDeg: aim.angle, power: aim.power },
    );
    this.credits[seat] += shotEarnings(outcome.damageToOpponent, outcome.directHits);

    this.pushStore();
    this.game.playShot(outcome.events, seat, {
      onDamage: (dmgSeat, _amount, _direct, hpAfter) => this.syncHp(dmgSeat, hpAfter),
      onFall: (fallSeat, hpAfter) => this.syncHp(fallSeat, hpAfter),
      onDone: () => this.endTurn(),
    });
  }

  private syncHp(seat: Seat, hpAfter: number): void {
    const seats = useAppStore.getState().seats;
    const next = [...seats] as typeof seats;
    next[seat] = { ...next[seat], hp: hpAfter, alive: hpAfter > 0 };
    useAppStore.setState({ seats: next });
  }

  private endTurn(): void {
    if (this.disposed) return;
    this.pushScene(); // snap tanks to exact sim positions after falls

    const dead = this.tanks.filter((t) => !t.alive);
    if (dead.length > 0) {
      this.phase = 'end';
      const winner: Seat | null = dead.length === 2 ? null : ((1 - dead[0].seat) as Seat);
      const humanWon = winner !== null && !this.isAiSeat(winner);
      if (winner === null || !humanWon) sfx.lose();
      else sfx.win();
      useAppStore.setState({
        matchPhase: 'end',
        winner,
        seats: [this.seatHud(0), this.seatHud(1)],
      });
      return;
    }

    this.turnSeat = (1 - this.turnSeat) as Seat;
    this.beginTurn();
  }

  // ---- Store/scene sync -------------------------------------------------

  private pushScene(): void {
    this.game.setTanks(this.tanks.map((t) => ({ seat: t.seat, x: t.x, y: t.y, alive: t.alive })));
    for (const t of this.tanks) this.game.setAim(t.seat, this.aims[t.seat].angle);
  }

  private pushStore(): void {
    const aim = this.aims[this.turnSeat];
    useAppStore.setState({
      matchActive: true,
      matchPhase: this.phase,
      turnSeat: this.turnSeat,
      loadoutSeat: this.phase === 'loadout' ? this.loadoutSeat : null,
      turnNumber: this.turnNumber,
      wind: this.wind,
      seats: [this.seatHud(0), this.seatHud(1)],
      inventories: [{ ...this.inventories[0] }, { ...this.inventories[1] }],
      aim: { angle: aim.angle, power: aim.power },
      selectedWeapon: this.weapons[this.turnSeat],
      sandbox: this.isSandbox,
      aiSeat: this.options.ai?.seat ?? null,
      winner: undefined,
    });
  }

  private seatHud(seat: Seat) {
    const t = this.tanks[seat];
    return {
      nickname: this.nicknames[seat],
      hp: t?.hp ?? this.config.startingHp,
      maxHp: this.config.startingHp,
      alive: t?.alive ?? true,
      credits: this.credits[seat],
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.aiSignal) this.aiSignal.cancelled = true;
    for (const t of this.timers) clearTimeout(t);
    if (this.aimAnimator) clearInterval(this.aimAnimator);
    this.game.onRoundLoaded = null;
  }
}
