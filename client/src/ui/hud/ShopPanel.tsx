import { checkPurchase, WEAPON_ORDER, WEAPONS, type WeaponId } from '@mortar/shared';
import type { Inventory } from '../../app/store';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';

/** Weapon storefront used for the pre-match loadout and the in-turn shop. */
export function ShopPanel({
  title,
  credits,
  inventory,
  onBuy,
  onDone,
  doneLabel,
  accentClass,
}: {
  title: string;
  credits: number;
  inventory: Inventory;
  onBuy: (id: WeaponId) => void;
  onDone: () => void;
  doneLabel: string;
  accentClass?: string;
}) {
  return (
    <GlassPanel className="pointer-events-auto flex max-h-[88dvh] w-[min(94vw,780px)] flex-col gap-4 p-6 max-sm:landscape:gap-2 max-sm:landscape:p-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className={`text-xl font-bold tracking-tight ${accentClass ?? 'text-white'}`}>{title}</h2>
        <span className="font-mono text-lg font-bold text-emerald-300">
          {credits.toLocaleString()} cr
        </span>
      </div>
      <div className="scroll-fade grid flex-1 grid-cols-2 gap-2 overflow-y-auto py-2 pr-1 sm:grid-cols-3 lg:grid-cols-4">
        {WEAPON_ORDER.filter((id) => WEAPONS[id].price !== null).map((id) => {
          const spec = WEAPONS[id];
          const owned = inventory[id] ?? 0;
          const affordable = checkPurchase(credits, id, 1).ok;
          return (
            <div
              key={id}
              className="flex flex-col justify-between gap-2 rounded-2xl border border-white/10 bg-black/25 p-3"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white/90">{spec.name}</span>
                  {owned > 0 && (
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold text-white/85">
                      ×{owned}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-snug text-white/50">{spec.blurb}</p>
              </div>
              <button
                disabled={!affordable}
                onClick={() => onBuy(id)}
                className="cursor-pointer rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink transition-all hover:bg-white active:scale-95 disabled:cursor-default disabled:bg-white/20 disabled:text-white/40"
              >
                {spec.price!.toLocaleString()} cr
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button onClick={onDone}>{doneLabel}</Button>
      </div>
    </GlassPanel>
  );
}
