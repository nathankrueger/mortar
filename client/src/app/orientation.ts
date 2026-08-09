import { useSyncExternalStore } from 'react';

/**
 * Fullscreen + landscape lock, attempted from a user gesture.
 * Android Chrome honors both; iOS Safari supports neither on iPhone (there the
 * PWA manifest's `display: fullscreen` + `orientation: landscape` take over
 * once the game is added to the home screen). All failures are silent.
 */
export function tryEnterGameFullscreen(): void {
  const el = document.documentElement;
  const lock = () => {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    orientation?.lock?.('landscape').catch(() => {});
  };
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
  } else {
    lock();
  }
}

const portraitQuery =
  typeof window !== 'undefined' ? window.matchMedia('(orientation: portrait)') : null;

function subscribe(cb: () => void): () => void {
  portraitQuery?.addEventListener('change', cb);
  return () => portraitQuery?.removeEventListener('change', cb);
}

export function useIsPortrait(): boolean {
  return useSyncExternalStore(subscribe, () => portraitQuery?.matches ?? false);
}
