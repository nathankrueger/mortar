import { WEAPONS, type WeaponId } from '@mortar/shared';
import { useAppStore } from '../../app/store';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';
import { IS_COARSE_POINTER, MobileControls } from './MobileControls';
import { PauseSheet } from './PauseSheet';
import { PlayerCard } from './PlayerCard';
import { ShopPanel } from './ShopPanel';
import { WeaponBar } from './WeaponBar';
import { WindPill } from './WindPill';

const SEAT_TEXT = ['text-p1', 'text-p2'] as const;

export interface HudCallbacks {
  onRestart: () => void;
  onExit: () => void;
  onBuy: (id: WeaponId) => void;
  onLoadoutReady: () => void;
  onSelectWeapon: (id: WeaponId) => void;
  onAimBy: (dAngle: number) => void;
  onSetPower: (power: number) => void;
  onFire: () => void;
  restartLabel?: string;
}

export function HudRoot({
  onRestart,
  onExit,
  onBuy,
  onLoadoutReady,
  onSelectWeapon,
  onAimBy,
  onSetPower,
  onFire,
  restartLabel = 'Play again',
}: HudCallbacks) {
  const phase = useAppStore((s) => s.matchPhase);
  const seats = useAppStore((s) => s.seats);
  const turnSeat = useAppStore((s) => s.turnSeat);
  const loadoutSeat = useAppStore((s) => s.loadoutSeat);
  const turnNumber = useAppStore((s) => s.turnNumber);
  const wind = useAppStore((s) => s.wind);
  const aim = useAppStore((s) => s.aim);
  const weapon = useAppStore((s) => s.selectedWeapon);
  const winner = useAppStore((s) => s.winner);
  const inventories = useAppStore((s) => s.inventories);
  const sandbox = useAppStore((s) => s.sandbox);
  const aiSeat = useAppStore((s) => s.aiSeat);
  const shopOpen = useAppStore((s) => s.shopOpen);
  const setShopOpen = useAppStore((s) => s.setShopOpen);
  const mySeat = useAppStore((s) => s.mySeat);
  const loadoutDone = useAppStore((s) => s.loadoutDone);
  const rematchVotes = useAppStore((s) => s.rematchVotes);
  const oppConnected = useAppStore((s) => s.oppConnected);
  const endReason = useAppStore((s) => s.endReason);

  const menuOpen = useAppStore((s) => s.menuOpen);
  const setMenuOpen = useAppStore((s) => s.setMenuOpen);

  const aiTurn = aiSeat !== null && turnSeat === aiSeat;
  const myTurn = phase === 'aim' && !aiTurn && (mySeat === null || turnSeat === mySeat);
  const canAct = myTurn && !shopOpen && !menuOpen;
  // Online, the tray and shop always show YOUR arsenal — never the opponent's.
  const arsenalSeat = mySeat ?? turnSeat;
  const shopSeat = phase === 'loadout' ? (loadoutSeat ?? 0) : arsenalSeat;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* Touch aiming layer sits under every other widget. */}
      {IS_COARSE_POINTER && canAct && (
        <MobileControls power={aim.power} onAimBy={onAimBy} onSetPower={onSetPower} onFire={onFire} />
      )}

      {/* Top bar */}
      <div className="absolute top-0 right-0 left-0 flex items-start justify-between gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]">
        <div className="flex items-start gap-2">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            className="pointer-events-auto mt-0.5 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-slate-900/50 text-white/85 backdrop-blur-xl transition-all hover:bg-black/40 active:scale-95"
          >
            <span className="text-lg leading-none">≡</span>
          </button>
          <PlayerCard
            seat={0}
            data={seats[0]}
            active={turnSeat === 0 && phase === 'aim'}
            hideCredits={mySeat !== null && mySeat !== 0}
          />
        </div>
        <div className="mt-1 flex flex-col items-center gap-2">
          <WindPill wind={wind} />
          {phase === 'resolving' && (
            <div className="rounded-full border border-white/10 bg-slate-900/45 px-3 py-1 text-xs text-white/50 backdrop-blur-xl">
              {WEAPONS[weapon].name} away…
            </div>
          )}
        </div>
        <PlayerCard
          seat={1}
          data={seats[1]}
          active={turnSeat === 1 && phase === 'aim'}
          hideCredits={mySeat !== null && mySeat !== 1}
        />
      </div>

      {/* Turn banner */}
      {phase === 'aim' && (
        <div
          key={`${turnNumber}-${turnSeat}`}
          className="turn-banner absolute top-24 left-1/2 -translate-x-1/2"
        >
          <span
            className={`rounded-full bg-slate-900/50 px-5 py-1.5 text-2xl font-bold tracking-tight backdrop-blur-xl ${SEAT_TEXT[turnSeat]}`}
          >
            {seats[turnSeat].nickname}
          </span>
        </div>
      )}

      {/* Bottom: weapons + readouts */}
      {(phase === 'aim' || phase === 'resolving') && (
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <WeaponBar
            selected={weapon}
            onSelect={onSelectWeapon}
            counts={sandbox ? undefined : inventories[arsenalSeat]}
            compact={IS_COARSE_POINTER}
          />
          <div className="flex items-center gap-3">
            {!sandbox && myTurn && (
              <button
                onClick={() => setShopOpen(true)}
                className="pointer-events-auto cursor-pointer rounded-full border border-emerald-300/30 bg-emerald-400/15 px-4 py-2 text-xs font-bold text-emerald-200 backdrop-blur-xl transition-all hover:bg-emerald-400/25 active:scale-95"
              >
                Shop
              </button>
            )}
            <div className="flex items-center gap-3 rounded-full border border-white/15 bg-slate-900/45 px-4 py-2 font-mono text-sm text-white/90 backdrop-blur-xl">
              <span>∠ {aim.angle.toFixed(0)}°</span>
              <span className="text-white/30">|</span>
              <span>⚡ {aim.power.toFixed(0)}</span>
            </div>
            {aiTurn ? (
              <span className="text-xs text-white/40">{seats[turnSeat].nickname} is aiming…</span>
            ) : (
              !IS_COARSE_POINTER && (
                <span className="hidden text-xs text-white/40 sm:block">
                  space to fire · esc for menu
                </span>
              )
            )}
          </div>
        </div>
      )}

      {/* Pre-match loadout */}
      {phase === 'loadout' && loadoutSeat !== null && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px]">
          {mySeat !== null && loadoutDone[loadoutSeat] ? (
            <GlassPanel className="flex items-center gap-3 px-8 py-6">
              <span className="text-sm text-white/70">Loadout locked — waiting for opponent…</span>
            </GlassPanel>
          ) : loadoutSeat === aiSeat ? (
            <GlassPanel className="flex items-center gap-3 px-8 py-6">
              <span className={`text-lg font-bold ${SEAT_TEXT[loadoutSeat]}`}>
                {seats[loadoutSeat].nickname}
              </span>
              <span className="text-sm text-white/60">is choosing a loadout…</span>
            </GlassPanel>
          ) : (
            <ShopPanel
              title={`${seats[loadoutSeat].nickname} — choose your loadout`}
              accentClass={SEAT_TEXT[loadoutSeat]}
              credits={seats[loadoutSeat].credits}
              inventory={inventories[loadoutSeat]}
              onBuy={onBuy}
              onDone={onLoadoutReady}
              doneLabel="Ready"
            />
          )}
        </div>
      )}

      {/* In-turn shop — only on your own turn, only your own wallet. */}
      {shopOpen && myTurn && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px]">
          <ShopPanel
            title={`${seats[shopSeat].nickname} — battlefield shop`}
            accentClass={SEAT_TEXT[shopSeat]}
            credits={seats[shopSeat].credits}
            inventory={inventories[shopSeat]}
            onBuy={onBuy}
            onDone={() => setShopOpen(false)}
            doneLabel="Close"
          />
        </div>
      )}

      {/* Match end */}
      {phase === 'end' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <GlassPanel className="pointer-events-auto flex flex-col items-center gap-4 px-10 py-8 text-center">
            <h2 className="text-3xl font-bold text-white">
              {winner == null
                ? 'Mutual destruction.'
                : seats[winner].nickname === 'You'
                  ? 'You win!'
                  : `${seats[winner].nickname} wins!`}
            </h2>
            <p className="text-sm text-white/60">
              {endReason === 'forfeit'
                ? 'The opponent left the battlefield.'
                : winner === null
                  ? 'Nobody survived that one.'
                  : 'The battlefield falls silent.'}
            </p>
            {mySeat !== null && rematchVotes.some(Boolean) && (
              <p className="text-xs font-medium text-emerald-300">
                {rematchVotes[mySeat]
                  ? 'Rematch requested — waiting for opponent…'
                  : 'Your opponent wants a rematch!'}
              </p>
            )}
            <div className="flex gap-3">
              <Button onClick={onRestart}>{restartLabel}</Button>
              <Button variant="glass" onClick={onExit}>
                Home
              </Button>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* Opponent connection notice */}
      {mySeat !== null && !oppConnected && phase !== 'end' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-400/15 px-4 py-1.5 text-xs font-semibold text-amber-200 backdrop-blur-xl">
          Opponent disconnected — waiting for them to return…
        </div>
      )}

      {/* Pause menu */}
      {menuOpen && (
        <PauseSheet
          onResume={() => setMenuOpen(false)}
          onExit={() => {
            setMenuOpen(false);
            onExit();
          }}
        />
      )}

    </div>
  );
}
