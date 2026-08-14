import {
  AI_PROFILES,
  resolveConfig,
  type AiDifficulty,
  type ColorPick,
  type MatchConfig,
  type Seat,
  type WeaponId,
} from '@mortar/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/routes';
import { randomSeed, useAppStore } from '../../app/store';
import { getGame } from '../../game/gameHost';
import { KeyboardInput } from '../../game/input/keyboard';
import { LocalSession } from '../../session/LocalSession';
import { HudRoot } from '../hud/HudRoot';

/**
 * Local match at one keyboard. Plain mode is the hidden hotseat duel with the
 * full economy; sandbox mode skips the shop and unlocks every weapon.
 */
export function HotseatScreen({
  sandbox = false,
  ai,
  config,
  colorPicks,
}: {
  sandbox?: boolean;
  ai?: { seat: Seat; difficulty: AiDifficulty };
  config?: Partial<MatchConfig>;
  /** Requested tank colors per seat (null = random each match). */
  colorPicks?: [ColorPick, ColorPick];
}) {
  const [runId, setRunId] = useState(0);
  const sessionRef = useRef<LocalSession | null>(null);

  useEffect(() => {
    const game = getGame();
    if (!game) return;

    let session: LocalSession | null = null;
    let keyboard: KeyboardInput | null = null;
    let tickerCb: ((ticker: { deltaMS: number }) => void) | null = null;
    let cancelled = false;

    void game.whenReady().then(() => {
      if (cancelled) return;
      const nicknames: [string, string] | undefined = ai
        ? ['You', `Computer · ${AI_PROFILES[ai.difficulty].label}`]
        : undefined;
      session = new LocalSession(game, randomSeed(), resolveConfig(config), nicknames, {
        sandbox,
        ai,
        colorPicks,
      });
      sessionRef.current = session;
      session.start();
      keyboard = new KeyboardInput({
        onFire: () => {
          const s = useAppStore.getState();
          if (s.matchPhase === 'aim' && !s.shopOpen && !s.menuOpen) session?.fire();
        },
        onEscape: () => {
          const s = useAppStore.getState();
          if (s.shopOpen) s.setShopOpen(false);
          else s.setMenuOpen(!s.menuOpen);
        },
      });
      tickerCb = (ticker) => {
        const { dAngle, dPower } = keyboard!.poll(ticker.deltaMS / 1000);
        if (dAngle !== 0 || dPower !== 0) session?.aimBy(dAngle, dPower);
      };
      game.app.ticker.add(tickerCb);
    });

    return () => {
      cancelled = true;
      keyboard?.dispose();
      if (tickerCb) game.app.ticker.remove(tickerCb);
      session?.dispose();
      sessionRef.current = null;
      useAppStore.getState().clearMatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, sandbox, ai, JSON.stringify(config)]);

  const onSelect = useCallback((id: WeaponId) => sessionRef.current?.selectWeapon(id), []);
  const onBuy = useCallback((id: WeaponId) => sessionRef.current?.buy(id), []);
  const onLoadoutReady = useCallback(() => sessionRef.current?.loadoutReady(), []);
  const onAimBy = useCallback((d: number) => sessionRef.current?.aimBy(d, 0), []);
  const onSetPower = useCallback((p: number) => {
    sessionRef.current?.setAim(useAppStore.getState().aim.angle, p);
  }, []);
  const onFire = useCallback(() => {
    const s = useAppStore.getState();
    if (s.matchPhase === 'aim' && !s.shopOpen && !s.menuOpen) sessionRef.current?.fire();
  }, []);

  return (
    <HudRoot
      onRestart={() => setRunId((r) => r + 1)}
      onExit={() => navigate('')}
      onBuy={onBuy}
      onLoadoutReady={onLoadoutReady}
      onSelectWeapon={onSelect}
      onAimBy={onAimBy}
      onSetPower={onSetPower}
      onFire={onFire}
    />
  );
}
