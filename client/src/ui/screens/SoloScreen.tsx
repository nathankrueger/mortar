import { AI_PROFILES, type AiDifficulty } from '@mortar/shared';
import { useState } from 'react';
import { navigate } from '../../app/routes';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';
import { HotseatScreen } from './HotseatScreen';

const BLURBS: Record<AiDifficulty, string> = {
  easy: 'Charmingly wide of the mark. Good first duel.',
  medium: 'Brackets you in a few shots. Stay mobile-minded.',
  hard: 'Simulates before it fires. Bring nukes.',
};

export function SoloScreen() {
  const [difficulty, setDifficulty] = useState<AiDifficulty | null>(null);

  if (difficulty) {
    return <HotseatScreen key={difficulty} ai={{ seat: 1, difficulty }} />;
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <GlassPanel className="pointer-events-auto flex max-h-[88dvh] w-full max-w-md flex-col gap-3 overflow-y-auto px-8 py-8 max-sm:landscape:gap-2 max-sm:landscape:py-4">
        <h1 className="text-center text-2xl font-bold text-white">Solo vs Computer</h1>
        <p className="mb-2 text-center text-sm text-white/60">Pick your opponent.</p>
        {(['easy', 'medium', 'hard'] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDifficulty(d)}
            className="cursor-pointer rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-left transition-all hover:bg-white/15 active:scale-[0.98]"
          >
            <span className="text-base font-bold text-white">{AI_PROFILES[d].label}</span>
            <p className="mt-0.5 text-xs text-white/55">{BLURBS[d]}</p>
          </button>
        ))}
        <Button variant="glass" className="mt-2" onClick={() => navigate('')}>
          Back
        </Button>
      </GlassPanel>
    </div>
  );
}
