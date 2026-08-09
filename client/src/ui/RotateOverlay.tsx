import { useEffect } from 'react';
import { useIsPortrait, tryEnterGameFullscreen } from '../app/orientation';
import { useAppStore } from '../app/store';
import { IS_COARSE_POINTER } from './hud/MobileControls';
import { GlassPanel } from './kit/GlassPanel';

/**
 * Phones play landscape, full stop. While a match is up in portrait, block the
 * screen with a rotate prompt; also use every touch during a match as the
 * gesture that requests native fullscreen + landscape lock.
 */
export function RotateOverlay() {
  const matchActive = useAppStore((s) => s.matchActive);
  const portrait = useIsPortrait();

  // Any tap during an active match doubles as the fullscreen/lock gesture.
  useEffect(() => {
    if (!IS_COARSE_POINTER || !matchActive) return;
    const onDown = () => tryEnterGameFullscreen();
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [matchActive]);

  if (!IS_COARSE_POINTER || !portrait || !matchActive) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0b1220]/85 backdrop-blur-md">
      <GlassPanel className="flex flex-col items-center gap-4 px-10 py-8 text-center">
        <span className="rotate-90 text-5xl">📱</span>
        <p className="text-lg font-bold text-white">Rotate your phone</p>
        <p className="max-w-56 text-sm text-white/60">
          Mortar Mayhem plays sideways — the whole battlefield needs the width.
        </p>
      </GlassPanel>
    </div>
  );
}
