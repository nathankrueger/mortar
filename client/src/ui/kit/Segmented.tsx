export interface SegmentOption<T> {
  label: string;
  value: T;
}

/** iOS-style segmented control for launch settings. */
export function Segmented<T>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-white/55 uppercase">{label}</span>
      <div className="flex rounded-xl border border-white/15 bg-black/25 p-1">
        {options.map((o) => (
          <button
            key={o.label}
            onClick={() => onChange(o.value)}
            className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-xs font-semibold transition-all ${
              o.value === value
                ? 'bg-white/90 text-ink shadow'
                : 'text-white/70 hover:bg-white/10'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
