import { useState } from 'react';
import { tryEnterGameFullscreen } from '../../app/orientation';
import { CAN_FULLSCREEN, IS_IOS, isStandalone } from '../../app/platform';
import { audio } from '../../audio/AudioEngine';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';

const VOL_KEY = 'mortar.volumes';

export function loadVolumes(): { sfx: number; ui: number } {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw) return JSON.parse(raw) as { sfx: number; ui: number };
  } catch {
    /* defaults */
  }
  return { sfx: 0.8, ui: 0.5 };
}

export function applySavedVolumes(): void {
  const v = loadVolumes();
  audio.setVolumes(v.sfx, v.ui);
}

/** In-game menu: volume, resume, leave. Opened with Esc or the ≡ button. */
export function PauseSheet({ onResume, onExit }: { onResume: () => void; onExit: () => void }) {
  const [vol, setVol] = useState(loadVolumes);

  const update = (sfx: number, ui: number) => {
    const next = { sfx, ui };
    setVol(next);
    audio.setVolumes(sfx, ui);
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/35 backdrop-blur-[3px]">
      <GlassPanel className="pointer-events-auto flex max-h-[88dvh] w-full max-w-xs flex-col gap-5 overflow-y-auto px-8 py-7 max-sm:landscape:gap-3 max-sm:landscape:py-4">
        <h2 className="text-center text-xl font-bold text-white">Paused</h2>
        <label className="flex flex-col gap-2">
          <span className="flex justify-between text-xs font-semibold text-white/60 uppercase">
            Effects volume <span>{Math.round(vol.sfx * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(vol.sfx * 100)}
            onChange={(e) => update(Number(e.target.value) / 100, vol.ui)}
            className="accent-white"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="flex justify-between text-xs font-semibold text-white/60 uppercase">
            Interface volume <span>{Math.round(vol.ui * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(vol.ui * 100)}
            onChange={(e) => update(vol.sfx, Number(e.target.value) / 100)}
            className="accent-white"
          />
        </label>
        <div className="flex flex-col gap-2">
          <Button onClick={onResume}>Resume</Button>
          {CAN_FULLSCREEN && (
            <Button
              variant="glass"
              onClick={() => {
                tryEnterGameFullscreen();
                onResume();
              }}
            >
              Enter fullscreen
            </Button>
          )}
          <Button variant="danger" onClick={onExit}>
            Leave match
          </Button>
          {IS_IOS && !isStandalone() && (
            <p className="text-center text-xs leading-snug text-white/45">
              iPhone fullscreen: Safari <span className="font-semibold">Share</span> ▸{' '}
              <span className="font-semibold">Add to Home Screen</span>, then launch from the icon.
            </p>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
