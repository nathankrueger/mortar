import { POWER_MAX, POWER_MIN } from '@mortar/shared';
import { useCallback, useRef } from 'react';

export { IS_COARSE_POINTER } from '../../app/platform';

/**
 * Touch controls: horizontal drag anywhere on the field swings the barrel,
 * the right-thumb slider sets power, and the big button fires.
 */
export function MobileControls({
  power,
  onAimBy,
  onSetPower,
  onFire,
}: {
  power: number;
  onAimBy: (dAngle: number) => void;
  onSetPower: (power: number) => void;
  onFire: () => void;
}) {
  return (
    <>
      <DragAimLayer onAimBy={onAimBy} />
      {/* Centered on the right edge so it clears the player tile above and
          the weapon tray below, even on short landscape screens. */}
      <div className="pointer-events-none absolute top-[55%] right-[max(0.75rem,env(safe-area-inset-right))] flex -translate-y-1/2 flex-col items-center gap-3">
        <PowerSlider power={power} onSetPower={onSetPower} />
        <button
          onPointerDown={(e) => {
            e.stopPropagation();
            onFire();
          }}
          className="pointer-events-auto flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border-2 border-red-300/50 bg-red-500/80 text-xs font-black tracking-widest text-white uppercase shadow-xl shadow-red-950/40 backdrop-blur-xl transition-transform active:scale-90"
        >
          Fire
        </button>
      </div>
    </>
  );
}

/** Invisible layer under the HUD widgets: horizontal drag = aim. */
function DragAimLayer({ onAimBy }: { onAimBy: (dAngle: number) => void }) {
  const lastX = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    lastX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (lastX.current === null) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      // Swipe right = barrel right (clockwise = smaller angle).
      onAimBy(-dx * 0.22);
    },
    [onAimBy],
  );

  const onPointerUp = useCallback(() => {
    lastX.current = null;
  }, []);

  return (
    <div
      className="pointer-events-auto absolute inset-0 touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

/** Power gained per pixel of drag — geared low so exact values are easy. */
const POWER_PER_PX = 0.3;

function PowerSlider({
  power,
  onSetPower,
}: {
  power: number;
  onSetPower: (power: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Relative drag: grabbing never jumps the value; movement nudges it from
  // where it was, so precise adjustments are deliberate instead of twitchy.
  const dragRef = useRef<{ startY: number; startPower: number } | null>(null);

  const onDrag = useCallback(
    (clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (drag.startY - clientY) * POWER_PER_PX;
      onSetPower(
        Math.round(Math.min(POWER_MAX, Math.max(POWER_MIN, drag.startPower + delta))),
      );
    },
    [onSetPower],
  );

  const frac = (power - POWER_MIN) / (POWER_MAX - POWER_MIN);

  return (
    <div
      ref={trackRef}
      className="pointer-events-auto relative h-[clamp(96px,32vh,176px)] w-12 touch-none rounded-full border border-white/20 bg-black/30 backdrop-blur-xl"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { startY: e.clientY, startPower: power };
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0 || e.pressure > 0) onDrag(e.clientY);
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <div
        className="absolute right-1 bottom-1 left-1 rounded-full bg-gradient-to-t from-amber-400/80 to-red-400/80"
        style={{ height: `calc(${Math.round(frac * 100)}% - 4px)` }}
      />
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center font-mono text-xs font-bold text-white/90 select-none">
        {power.toFixed(0)}
      </span>
    </div>
  );
}
