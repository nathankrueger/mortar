import { useEffect, useRef } from 'react';
import { useAppStore } from '../app/store';
import { GameApp } from './GameApp';
import { setGame } from './gameHost';

/**
 * Hosts the Pixi canvas. In ambient mode it renders the seed-preview
 * battlefield (home backdrop / terrain dev); otherwise an active GameSession
 * drives the scene through the gameHost handle.
 */
export function GameCanvas({ ambient = true }: { ambient?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameApp | null>(null);
  const seed = useAppStore((s) => s.previewSeed);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = new GameApp();
    gameRef.current = game;
    setGame(game);
    void game.init(host);
    return () => {
      gameRef.current = null;
      setGame(null);
      game.destroy();
    };
  }, []);

  useEffect(() => {
    if (!ambient) return;
    const game = gameRef.current;
    if (!game) return;
    game.onRoundLoaded = (info) => useAppStore.getState().setPreviewInfo(info);
    game.loadRound(seed);
  }, [seed, ambient]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" />;
}
