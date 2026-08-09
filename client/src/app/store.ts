import type { Seat, WeaponId } from '@mortar/shared';
import { create } from 'zustand';
import type { RoundInfo } from '../game/GameApp';

function seedFromHash(): number | null {
  const m = /[?&]seed=(\d+)/.exec(window.location.hash);
  return m ? Number(m[1]) >>> 0 : null;
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export interface SeatHud {
  nickname: string;
  hp: number;
  maxHp: number;
  alive: boolean;
  credits: number;
}

export type Inventory = Partial<Record<WeaponId, number>>;

const idleSeats: [SeatHud, SeatHud] = [
  { nickname: 'Player 1', hp: 100, maxHp: 100, alive: true, credits: 0 },
  { nickname: 'Player 2', hp: 100, maxHp: 100, alive: true, credits: 0 },
];

interface AppState {
  // Ambient terrain preview (home screen backdrop + dev route).
  previewSeed: number;
  previewInfo: RoundInfo | null;
  setPreviewSeed: (seed: number) => void;
  setPreviewInfo: (info: RoundInfo) => void;

  // Live match HUD state (written by the active GameSession).
  matchActive: boolean;
  matchPhase: 'loadout' | 'aim' | 'resolving' | 'end';
  turnSeat: Seat;
  /** Which seat is picking its loadout (null outside the loadout phase). */
  loadoutSeat: Seat | null;
  turnNumber: number;
  wind: number;
  seats: [SeatHud, SeatHud];
  inventories: [Inventory, Inventory];
  aim: { angle: number; power: number };
  selectedWeapon: WeaponId;
  sandbox: boolean;
  /** Seat controlled by the computer (null = both human). */
  aiSeat: Seat | null;
  /** Whether the in-turn shop overlay is open. */
  shopOpen: boolean;
  setShopOpen: (open: boolean) => void;
  /** Whether the pause menu is open. */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** undefined = match running; null = draw; otherwise winning seat. */
  winner: Seat | null | undefined;
  endReason: 'destroyed' | 'forfeit' | null;

  // Online-play state (written by NetworkSession / OnlineScreen).
  mySeat: Seat | null;
  roomCode: string | null;
  peers: { seat: Seat; nickname: string; connected: boolean; ready: boolean }[];
  loadoutDone: [boolean, boolean];
  rematchVotes: [boolean, boolean];
  oppConnected: boolean;
  netError: string | null;

  clearMatch: () => void;
}

export const useAppStore: ReturnType<typeof createAppStore> = createAppStore();

// Debug/e2e handle for headless verification.
(window as unknown as { __store?: typeof useAppStore }).__store = useAppStore;

function createAppStore() {
  return create<AppState>()((set) => ({
  previewSeed: seedFromHash() ?? randomSeed(),
  previewInfo: null,
  setPreviewSeed: (previewSeed) => set({ previewSeed }),
  setPreviewInfo: (previewInfo) => set({ previewInfo }),

  matchActive: false,
  matchPhase: 'aim',
  turnSeat: 0,
  loadoutSeat: null,
  turnNumber: 0,
  wind: 0,
  seats: idleSeats,
  inventories: [{}, {}],
  aim: { angle: 60, power: 55 },
  selectedWeapon: 'mortar',
  sandbox: false,
  aiSeat: null,
  shopOpen: false,
  setShopOpen: (shopOpen) => set({ shopOpen }),
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  winner: undefined,
  endReason: null,
  mySeat: null,
  roomCode: null,
  peers: [],
  loadoutDone: [false, false],
  rematchVotes: [false, false],
  oppConnected: true,
  netError: null,
  clearMatch: () =>
    set({
      matchActive: false,
      matchPhase: 'aim',
      turnSeat: 0,
      loadoutSeat: null,
      turnNumber: 0,
      wind: 0,
      seats: idleSeats,
      inventories: [{}, {}],
      sandbox: false,
      aiSeat: null,
      shopOpen: false,
      menuOpen: false,
      winner: undefined,
      endReason: null,
      mySeat: null,
      roomCode: null,
      peers: [],
      loadoutDone: [false, false],
      rematchVotes: [false, false],
      oppConnected: true,
      netError: null,
    }),
  }));
}
