import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@renderer/lib/utils';

// GlassButton — the canonical glass-pill button used across the v4
// dashboard. Four variants share identical geometry (999px radius,
// h-11, px-6, glass stack), differing only in fill:
//
// - primary:   violet→cyan gradient, white text (the hero "Get Started")
// - secondary: aurora-cyan tinted glass, ink text
// - tertiary:  pure clear glass, ink text
// - mono:      compact mono-cased clear pill for utility actions
//
// Hover lifts ~1.5%, brightens the inner specular, deepens the shadow.
// Active sinks ~1.5% with an inset shadow. Same interaction language
// across every variant.
export type GlassButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'mono' | 'danger';

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GlassButtonVariant;
  icon?: ReactNode;
};

const base =
  'relative isolate inline-flex items-center gap-2 rounded-full ' +
  'transition-[transform,box-shadow,background] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'border border-white/65 ' +
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),inset_0_-1px_0_0_rgba(20,19,26,0.06),0_8px_24px_-12px_rgba(20,19,26,0.18),0_2px_6px_-2px_rgba(20,19,26,0.08)] ' +
  '[backdrop-filter:blur(24px)_saturate(180%)] [-webkit-backdrop-filter:blur(24px)_saturate(180%)] ' +
  'hover:scale-[1.015] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,1),inset_0_-1px_0_0_rgba(20,19,26,0.06),0_12px_32px_-12px_rgba(20,19,26,0.22),0_2px_6px_-2px_rgba(20,19,26,0.08)] ' +
  'active:scale-[0.985] active:shadow-[inset_0_2px_4px_0_rgba(20,19,26,0.12),inset_0_-1px_0_0_rgba(20,19,26,0.06),0_2px_8px_-4px_rgba(20,19,26,0.18)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

const sized = 'h-11 px-6 text-[14px] font-medium tracking-[-0.01em]';

const monoSized = 'h-11 px-5 text-[12px] font-mono uppercase tracking-[0.04em]';

const variants: Record<GlassButtonVariant, string> = {
  primary:
    'text-white [background:linear-gradient(135deg,var(--a-violet)_0%,var(--a-cyan)_100%)] ' +
    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.4),0_10px_30px_-10px_rgba(124,92,255,0.45),0_2px_6px_-2px_rgba(20,19,26,0.08)] ' +
    'hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),0_14px_36px_-10px_rgba(124,92,255,0.55),0_2px_6px_-2px_rgba(20,19,26,0.08)]',
  secondary: 'text-[color:var(--ink-1)] [background:rgba(61,198,255,0.18)]',
  tertiary: 'text-[color:var(--ink-1)] [background:var(--glass-fill)]',
  mono: 'text-[color:var(--ink-2)] [background:var(--glass-fill-lo)]',
  danger:
    'text-white [background:linear-gradient(135deg,#ef4444_0%,#dc2626_100%)] ' +
    'border-red-400/50 ' +
    'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_10px_30px_-10px_rgba(239,68,68,0.4),0_2px_6px_-2px_rgba(20,19,26,0.08)] ' +
    'hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_14px_36px_-10px_rgba(239,68,68,0.5),0_2px_6px_-2px_rgba(20,19,26,0.08)]',
};

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ variant = 'tertiary', icon, className, children, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(base, variant === 'mono' ? monoSized : sized, variants[variant], className)}
      {...rest}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
);

GlassButton.displayName = 'GlassButton';
