import { useState } from 'react';
import { navigate } from '../../app/routes';
import { randomSeed, useAppStore } from '../../app/store';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';

/** Dev screen: regenerate terrain by seed, inspect theme/macro rolls. */
export function TerrainDev() {
  const seed = useAppStore((s) => s.previewSeed);
  const info = useAppStore((s) => s.previewInfo);
  const setSeed = useAppStore((s) => s.setPreviewSeed);
  const [draft, setDraft] = useState(String(seed));

  const apply = (value: number) => {
    const v = value >>> 0;
    setDraft(String(v));
    setSeed(v);
    window.history.replaceState(null, '', `#/dev/terrain?seed=${v}`);
  };

  return (
    <div className="pointer-events-none absolute inset-0 p-4">
      <GlassPanel className="pointer-events-auto inline-flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <button
            className="cursor-pointer rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20"
            onClick={() => navigate('')}
          >
            ← Back
          </button>
          <span className="text-sm font-semibold text-white/85">Terrain preview</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-36 rounded-xl border border-white/15 bg-black/25 px-3 py-2 font-mono text-sm text-white outline-none focus:border-white/40"
            value={draft}
            inputMode="numeric"
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && apply(Number(draft || 0))}
          />
          <Button variant="glass" className="px-4 py-2 text-sm" onClick={() => apply(Number(draft || 0))}>
            Load
          </Button>
          <Button className="px-4 py-2 text-sm" onClick={() => apply(randomSeed())}>
            Random
          </Button>
        </div>
        {info && (
          <p className="font-mono text-xs text-white/60">
            seed {info.seed} · {info.themeName.toLowerCase()} · {info.macro} · {info.weather}
          </p>
        )}
      </GlassPanel>
    </div>
  );
}
