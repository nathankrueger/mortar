import type { GameApp } from './GameApp';

// Module-level handle so screens/sessions can reach the GameApp instance that
// GameCanvas owns. One game at a time.

let current: GameApp | null = null;

export function setGame(game: GameApp | null): void {
  current = game;
}

export function getGame(): GameApp | null {
  return current;
}
