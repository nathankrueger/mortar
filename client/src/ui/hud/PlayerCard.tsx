import type { SeatHud } from '../../app/store';

const ACCENTS = ['bg-p1', 'bg-p2'] as const;

export function PlayerCard({
  seat,
  data,
  active,
}: {
  seat: 0 | 1;
  data: SeatHud;
  active: boolean;
}) {
  const pct = Math.max(0, Math.min(1, data.hp / data.maxHp));
  return (
    <div
      className={`flex min-w-40 flex-col gap-1.5 rounded-2xl border px-4 py-3 backdrop-blur-xl transition-all duration-300 ${
        active
          ? 'border-white/30 bg-white/15 shadow-lg shadow-black/30'
          : 'border-white/10 bg-black/20 opacity-75'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${ACCENTS[seat]}`} />
        <span className="text-sm font-semibold text-white/90">{data.nickname}</span>
        {!data.alive && <span className="text-xs text-white/50">✕</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ${ACCENTS[seat]}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-white/60">{data.hp} HP</span>
        <span className="font-mono text-xs font-semibold text-emerald-300/90">
          {data.credits.toLocaleString()} cr
        </span>
      </div>
    </div>
  );
}
