import type { SeatHud } from '../../app/store';

const ACCENTS = ['bg-p1', 'bg-p2'] as const;

export function PlayerCard({
  seat,
  data,
  active,
  hideCredits = false,
}: {
  seat: 0 | 1;
  data: SeatHud;
  active: boolean;
  /** Online: the opponent's purchasing power is their business. */
  hideCredits?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, data.hp / data.maxHp));
  return (
    <div
      className={`flex min-w-32 flex-col gap-1 rounded-xl border px-3 py-2 backdrop-blur-xl transition-all duration-300 ${
        active
          ? 'border-white/35 bg-slate-900/55 shadow-lg shadow-black/30'
          : 'border-white/10 bg-slate-900/35 opacity-75'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${ACCENTS[seat]}`} />
        <span className="text-xs font-semibold text-white/90">{data.nickname}</span>
        {!data.alive && <span className="text-[11px] text-white/50">✕</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
        <div
          className={`h-full rounded-full transition-all duration-500 ${ACCENTS[seat]}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium text-white/60">{data.hp} HP</span>
        {!hideCredits && (
          <span className="font-mono text-[11px] font-semibold text-emerald-300/90">
            {data.credits.toLocaleString()} cr
          </span>
        )}
      </div>
    </div>
  );
}
