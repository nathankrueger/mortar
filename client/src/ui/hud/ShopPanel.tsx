import { checkPurchase, WEAPON_ORDER, WEAPONS, type WeaponId } from '@mortar/shared';
import type { Inventory } from '../../app/store';
import { Button } from '../kit/Button';
import { GlassPanel } from '../kit/GlassPanel';

/**
 * Weapon storefront for the pre-match loadout and the in-turn shop.
 * Compact by design: the confirm button lives in the header row and cards
 * shrink (blurbs hide) on short screens so the grid gets all the space.
 */
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
    <GlassPanel className="pointer-events-auto flex max-h-[92dvh] w-[min(94vw,820px)] flex-col gap-2 p-4 max-sm:landscape:p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className={`truncate text-base font-bold tracking-tight sm:text-lg ${accentClass ?? 'text-white'}`}>
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm font-bold text-emerald-300 sm:text-base">
            {credits.toLocaleString()} cr
          </span>
          <Button onClick={onDone} className="px-5 py-1.5 text-sm">
            {doneLabel}
          </Button>
        </div>
      </div>
      <div className="scroll-fade grid flex-1 grid-cols-2 gap-1.5 overflow-y-auto py-2 pr-1 sm:grid-cols-3 md:grid-cols-4">
        {WEAPON_ORDER.filter((id) => WEAPONS[id].price !== null).map((id) => {
          const spec = WEAPONS[id];
          const owned = inventory[id] ?? 0;
          const affordable = checkPurchase(credits, id, 1).ok;
          return (
            <div
              key={id}
              title={spec.blurb}
              className="flex flex-col justify-between gap-1.5 rounded-xl border border-white/10 bg-black/25 p-2.5"
            >
              <div>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-bold text-white/90 sm:text-sm">
                    {spec.name}
                  </span>
                  {owned > 0 && (
                    <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white/85">
                      ×{owned}
                    </span>
                  )}
                </div>
                <p className="shop-blurb mt-0.5 text-[11px] leading-snug text-white/50">
                  {spec.blurb}
                </p>
              </div>
              <button
                disabled={!affordable}
                onClick={() => onBuy(id)}
                className="cursor-pointer rounded-full bg-white/90 px-2 py-1 text-[11px] font-bold text-ink transition-all hover:bg-white active:scale-95 disabled:cursor-default disabled:bg-white/20 disabled:text-white/40"
              >
                {spec.price!.toLocaleString()} cr
              </button>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
