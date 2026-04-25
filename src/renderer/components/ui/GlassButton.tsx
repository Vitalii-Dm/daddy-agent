import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { cn } from '@renderer/lib/utils';

// GlassButton — the canonical liquid-glass pill used across the v4
// dashboard. All variants share geometry (999px radius, h-11, px-6)
// and the four-layer glass stack. The fill differs per variant.
//
// Glass-critical properties (backdrop-filter, box-shadow, background)
// are applied via inline styles so they render reliably regardless
// of how Tailwind's JIT scans long arbitrary-value class strings.
export type GlassButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'mono';

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: GlassButtonVariant;
  icon?: ReactNode;
};

const GLASS_BASE_SHADOW =
  'inset 0 1px 0 0 rgba(255,255,255,0.95), inset 0 -1px 0 0 rgba(20,19,26,0.06), 0 10px 28px -14px rgba(20,19,26,0.22), 0 2px 6px -2px rgba(20,19,26,0.10)';

const GLASS_HOVER_SHADOW =
  'inset 0 1px 0 0 rgba(255,255,255,1), inset 0 -1px 0 0 rgba(20,19,26,0.07), 0 16px 40px -14px rgba(20,19,26,0.28), 0 2px 6px -2px rgba(20,19,26,0.10)';

const GLASS_PRESSED_SHADOW =
  'inset 0 2px 4px 0 rgba(20,19,26,0.14), inset 0 -1px 0 0 rgba(20,19,26,0.06), 0 2px 8px -4px rgba(20,19,26,0.20)';

const PRIMARY_SHADOW =
  'inset 0 1px 0 0 rgba(255,255,255,0.5), 0 12px 32px -10px rgba(124,92,255,0.55), 0 2px 6px -2px rgba(20,19,26,0.10)';

const PRIMARY_HOVER_SHADOW =
  'inset 0 1px 0 0 rgba(255,255,255,0.65), 0 18px 44px -10px rgba(124,92,255,0.62), 0 2px 6px -2px rgba(20,19,26,0.10)';

const VARIANT_BG: Record<GlassButtonVariant, string> = {
  // Violet→cyan gradient — same as the hero "Get started" CTA
  primary: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
  // Cyan-tinted glass: layer the tint over a real white glass fill so
  // the button reads as substantial, not as a faint translucent chip
  secondary:
    'linear-gradient(135deg, rgba(61,198,255,0.28), rgba(124,92,255,0.10)), rgba(255,255,255,0.55)',
  // Clear glass with the canonical fill-hi token — visibly white-bright
  // against the warm-paper background
  tertiary: 'rgba(255,255,255,0.62)',
  // Mono pill — quieter clear glass for utility actions
  mono: 'rgba(255,255,255,0.46)',
};

const VARIANT_TEXT: Record<GlassButtonVariant, string> = {
  primary: '#ffffff',
  secondary: 'var(--ink-1)',
  tertiary: 'var(--ink-1)',
  mono: 'var(--ink-2)',
};

const VARIANT_BORDER: Record<GlassButtonVariant, string> = {
  primary: '1px solid rgba(255,255,255,0.45)',
  secondary: '1px solid rgba(255,255,255,0.7)',
  tertiary: '1px solid rgba(255,255,255,0.7)',
  mono: '1px solid rgba(255,255,255,0.65)',
};

const baseClass =
  'group relative isolate inline-flex select-none items-center justify-center gap-2 ' +
  'rounded-full whitespace-nowrap ' +
  'transition-[transform,box-shadow,background] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'will-change-transform ' +
  'hover:-translate-y-[1px] active:translate-y-[0.5px] ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

const sizedClass = 'h-11 px-6 text-[14px] font-medium tracking-[-0.01em]';
const monoSizedClass = 'h-11 px-5 text-[12px] font-mono uppercase tracking-[0.06em]';

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  (
    {
      variant = 'tertiary',
      icon,
      className,
      children,
      type,
      onMouseEnter,
      onMouseLeave,
      onMouseDown,
      onMouseUp,
      ...rest
    },
    ref
  ) => {
    const isPrimary = variant === 'primary';
    const baseShadow = isPrimary ? PRIMARY_SHADOW : GLASS_BASE_SHADOW;
    const hoverShadow = isPrimary ? PRIMARY_HOVER_SHADOW : GLASS_HOVER_SHADOW;

    const style: CSSProperties = {
      background: VARIANT_BG[variant],
      color: VARIANT_TEXT[variant],
      border: VARIANT_BORDER[variant],
      backdropFilter: isPrimary ? undefined : 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: isPrimary ? undefined : 'blur(24px) saturate(180%)',
      boxShadow: baseShadow,
    };

    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn(baseClass, variant === 'mono' ? monoSizedClass : sizedClass, className)}
        style={style}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = hoverShadow;
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = baseShadow;
          onMouseLeave?.(e);
        }}
        onMouseDown={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = GLASS_PRESSED_SHADOW;
          onMouseDown?.(e);
        }}
        onMouseUp={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = hoverShadow;
          onMouseUp?.(e);
        }}
        {...rest}
      >
        {/* Inner specular highlight — sits on top of the fill, gives
            the surface its glass curvature reading. Hidden on primary
            because the gradient already carries the highlight. */}
        {!isPrimary && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-2 top-px h-[40%] rounded-full"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 100%)',
              opacity: 0.85,
            }}
          />
        )}
        <span className="relative z-10 inline-flex items-center gap-2">
          {icon}
          <span>{children}</span>
        </span>
      </button>
    );
  }
);

GlassButton.displayName = 'GlassButton';
