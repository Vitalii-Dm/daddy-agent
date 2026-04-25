import React, { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@renderer/lib/utils';

// AuroraButton — the four locked v3 variants. All share the 999px radius
// and the four-layer glass stack (backdrop blur, fill, inset specular,
// soft drop). Variants only differ in the fill layer.
//
// - primary:   violet→cyan gradient, white text, CTA halo
// - secondary: aurora-cyan tinted glass, ink text, specular sweep on hover
// - tertiary:  clear glass, ink text
// - send:      clear glass, Geist Mono uppercase utility pill (chat-context)
export type AuroraButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'send';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AuroraButtonVariant;
  size?: 'sm' | 'md';
};

const baseClasses =
  'group relative inline-flex select-none items-center justify-center gap-2 rounded-full ' +
  'transition-[transform,box-shadow,background] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
  'will-change-transform focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-[color:var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-60';

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-9 px-4 text-[12.5px]',
  md: 'h-12 px-6 text-[14px]',
};

const variantClasses: Record<AuroraButtonVariant, string> = {
  primary:
    'font-medium text-white border border-white/35 ' +
    'hover:-translate-y-[1px] active:translate-y-0',
  secondary:
    'font-medium text-[color:var(--ink-1)] border border-white/65 overflow-hidden ' +
    'hover:-translate-y-[1px] active:translate-y-[0.5px]',
  tertiary:
    'font-medium text-[color:var(--ink-1)] border border-white/65 ' +
    'hover:-translate-y-[1px] active:translate-y-[0.5px]',
  send:
    'font-mono uppercase tracking-[0.18em] text-[11px] text-[color:var(--ink-1)] ' +
    'border border-white/65 hover:-translate-y-[1px] active:translate-y-[0.5px]',
};

const variantStyle: Record<AuroraButtonVariant, React.CSSProperties> = {
  primary: {
    background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
    boxShadow:
      '0 14px 38px -14px rgba(124, 92, 255, 0.55), 0 4px 12px -4px rgba(61, 198, 255, 0.35), inset 0 1px 0 rgba(255,255,255,0.4)',
  },
  secondary: {
    background:
      'linear-gradient(135deg, rgba(61, 198, 255, 0.18), rgba(124, 92, 255, 0.10)), rgba(255, 255, 255, 0.48)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(20,19,26,0.05), 0 8px 24px -10px rgba(20,19,26,0.18)',
  },
  tertiary: {
    background: 'rgba(255, 255, 255, 0.48)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(20,19,26,0.05), 0 8px 24px -10px rgba(20,19,26,0.14)',
  },
  send: {
    background: 'rgba(255, 255, 255, 0.48)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(20,19,26,0.05), 0 4px 14px -8px rgba(20,19,26,0.18)',
    paddingInline: 18,
    height: 36,
  },
};

export const AuroraButton = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'tertiary', size = 'md', className, style, children, ...rest }, ref) => {
    const composedStyle = { ...variantStyle[variant], ...style };
    return (
      <button
        ref={ref}
        type={rest.type ?? 'button'}
        className={cn(
          baseClasses,
          variant !== 'send' && sizeClasses[size],
          variantClasses[variant],
          className
        )}
        style={composedStyle}
        {...rest}
      >
        {variant === 'secondary' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full"
            style={{
              background:
                'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)',
            }}
          />
        )}
        <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      </button>
    );
  }
);

AuroraButton.displayName = 'AuroraButton';
