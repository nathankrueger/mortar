export function WindPill({ wind }: { wind: number }) {
  const strength = Math.abs(wind) / 12;
  const arrows = wind === 0 ? '·' : (wind > 0 ? '→' : '←').repeat(strength > 6 ? 3 : strength > 3 ? 2 : 1);
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/50 px-4 py-1.5 backdrop-blur-xl">
      <span className="text-xs font-semibold tracking-wide text-white/55 uppercase">Wind</span>
      <span className="font-mono text-sm font-bold text-white/90">
        {arrows} {strength.toFixed(1)}
      </span>
    </div>
  );
}
