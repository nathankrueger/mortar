import { WEAPON_ORDER, WEAPONS, type WeaponId } from '@mortar/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';

const KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
const KEY_CODES = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
  'Minus',
  'Equal',
];

/**
 * Weapon selector chips — only what's actually in the arsenal.
 * counts === undefined ⇒ sandbox: everything unlocked and ∞.
 * Number keys map to the visible chips, left to right.
 */
export function WeaponBar({
  selected,
  onSelect,
  counts,
  compact = false,
}: {
  selected: WeaponId;
  onSelect: (id: WeaponId) => void;
  counts?: Partial<Record<WeaponId, number>>;
  /** Single scrollable row for small/touch screens. */
  compact?: boolean;
}) {
  const visible = WEAPON_ORDER.filter((id) => available(id, counts));

  // Compact mode scrolls horizontally; fade the clipped edges so chips melt
  // away instead of cutting hard. Each side fades only while it's clipping.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState({ left: false, right: false });
  const updateClip = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setClip((c) => (c.left === left && c.right === right ? c : { left, right }));
  }, []);

  useEffect(() => {
    if (!compact || !scrollRef.current) return;
    updateClip();
    const ro = new ResizeObserver(updateClip);
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [compact, updateClip, visible.length]);

  const fadeMask =
    clip.left || clip.right
      ? `linear-gradient(to right, ${clip.left ? 'transparent, black 2.5rem' : 'black'}, ${
          clip.right ? 'black calc(100% - 2.5rem), transparent' : 'black'
        })`
      : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = KEY_CODES.indexOf(e.code);
      if (idx < 0 || idx >= visible.length) return;
      onSelect(visible[idx]);
      sfx.uiTick();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelect, JSON.stringify(visible)]);

  return (
    <div
      ref={scrollRef}
      onScroll={compact ? updateClip : undefined}
      style={compact ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
      className={
        compact
          ? 'pointer-events-auto flex max-w-[80vw] items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]'
          : 'pointer-events-auto flex max-w-[95vw] flex-wrap items-center justify-center gap-1.5'
      }
    >
      {visible.map((id, i) => {
        const spec = WEAPONS[id];
        const count = spec.price === null || !counts ? '∞' : (counts[id] ?? 0);
        const active = id === selected;
        return (
          <button
            key={id}
            onClick={() => {
              onSelect(id);
              sfx.uiTick();
            }}
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-xl transition-all duration-150 ${
              active
                ? 'border-white/60 bg-white/90 text-ink shadow-lg'
                : 'border-white/15 bg-slate-900/50 text-white/85 hover:bg-black/40'
            }`}
            title={spec.blurb}
          >
            <span className={active ? 'text-black/40' : 'text-white/35'}>{KEY_LABELS[i] ?? ''}</span>
            {spec.name}
            <span className={active ? 'text-black/40' : 'text-white/35'}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function available(id: WeaponId, counts?: Partial<Record<WeaponId, number>>): boolean {
  if (WEAPONS[id].price === null) return true;
  if (!counts) return true;
  return (counts[id] ?? 0) > 0;
}
