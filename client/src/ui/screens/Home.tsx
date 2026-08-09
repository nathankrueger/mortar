import { useState } from 'react';
import { IS_IOS, isStandalone } from '../../app/platform';
import { navigate } from '../../app/routes';
import { loadRejoin } from '../../session/rejoinStorage';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';

const A2HS_KEY = 'mortar.a2hs-dismissed';

export function Home() {
  const [rejoin] = useState(loadRejoin);
  const [hintDismissed, setHintDismissed] = useState(() => {
    try {
      return localStorage.getItem(A2HS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const showIosHint = IS_IOS && !isStandalone() && !hintDismissed;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <GlassPanel className="pointer-events-auto flex max-h-[88dvh] w-full max-w-sm flex-col items-stretch gap-3 overflow-y-auto px-8 py-9 text-center max-sm:landscape:gap-2 max-sm:landscape:py-5">
        <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg">
          Mortar Mayhem
        </h1>
        <p className="mb-4 text-sm font-medium text-white/65">Turn-based artillery, reborn.</p>
        {rejoin && (
          <Button variant="glass" className="border-emerald-300/40 text-emerald-200" onClick={() => navigate('/online/rejoin')}>
            Resume match · {rejoin.code}
          </Button>
        )}
        <Button onClick={() => navigate('/solo')}>Solo vs Computer</Button>
        <Button variant="glass" onClick={() => navigate('/online/create')}>
          Create Room
        </Button>
        <Button variant="glass" onClick={() => navigate('/online/join')}>
          Join Room
        </Button>
        {showIosHint && (
          <div className="mt-1 flex items-start gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/10 px-4 py-3 text-left">
            <span className="text-base leading-none">📲</span>
            <p className="flex-1 text-xs leading-snug text-sky-100/90">
              <span className="font-bold">Want true fullscreen?</span> Safari won't hide its bars —
              tap <span className="font-bold">Share</span> ▸{' '}
              <span className="font-bold">Add to Home Screen</span>, then play from the icon.
            </p>
            <button
              aria-label="Dismiss"
              className="cursor-pointer text-sky-100/60 hover:text-white"
              onClick={() => {
                setHintDismissed(true);
                try {
                  localStorage.setItem(A2HS_KEY, '1');
                } catch {
                  /* ignore */
                }
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div className="mt-3 flex justify-center gap-4">
          <button
            className="cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white/80"
            onClick={() => navigate('/dev/terrain')}
          >
            dev · terrain →
          </button>
          <button
            className="cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white/80"
            onClick={() => navigate('/dev/hotseat')}
          >
            dev · hotseat →
          </button>
          <button
            className="cursor-pointer text-xs font-medium text-white/50 transition-colors hover:text-white/80"
            onClick={() => navigate('/dev/sandbox')}
          >
            dev · sandbox →
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}
