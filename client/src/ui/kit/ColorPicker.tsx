import { cssColor, TANK_PALETTE, type ColorPick } from '@mortar/shared';

/**
 * Tank livery picker: one swatch per palette entry plus a "random" chip.
 * null = surprise me each match (the default).
 */
export function ColorPicker({
  value,
  onChange,
}: {
  value: ColorPick;
  onChange: (v: ColorPick) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-white/55 uppercase">Tank color</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onChange(null)}
          title="Random each match"
          aria-label="Random color"
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-dashed text-sm font-bold transition-all ${
            value === null
              ? 'scale-110 border-white text-white'
              : 'border-white/30 text-white/50 hover:scale-105 hover:text-white/80'
          }`}
        >
          ?
        </button>
        {TANK_PALETTE.map((c, i) => (
          <button
            key={c.name}
            onClick={() => onChange(i)}
            title={c.name}
            aria-label={`${c.name} tank`}
            className={`h-9 w-9 cursor-pointer rounded-full border-2 transition-all ${
              value === i ? 'scale-110 border-white' : 'border-white/25 hover:scale-105'
            }`}
            style={{ backgroundColor: cssColor(c.main) }}
          />
        ))}
      </div>
    </div>
  );
}
