import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'glass' | 'danger';

const styles: Record<Variant, string> = {
  primary:
    'bg-white text-ink hover:bg-white/90 active:scale-[0.97] shadow-lg shadow-black/30',
  glass:
    'bg-white/10 text-white border border-white/15 hover:bg-white/20 active:scale-[0.97] backdrop-blur-xl',
  danger:
    'bg-red-500/90 text-white hover:bg-red-500 active:scale-[0.97] shadow-lg shadow-red-950/40',
};

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`cursor-pointer rounded-full px-6 py-3 text-[15px] font-semibold transition-all duration-150 select-none disabled:pointer-events-none disabled:opacity-40 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
