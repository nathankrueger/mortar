import type { HTMLAttributes, ReactNode } from 'react';

/** Frosted-glass surface — the base material for every floating UI panel. */
export function GlassPanel({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-3xl border border-white/20 bg-slate-900/45 shadow-2xl shadow-black/40 backdrop-blur-2xl ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
