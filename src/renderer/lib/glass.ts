import { cn } from './utils';

export type GlassTone = 'clear' | 'tinted' | 'sunken';

export interface GlassOptions {
  tone?: GlassTone;
  refract?: boolean;
  radius?: number;
  bordered?: boolean;
  shadow?: 'soft' | 'lifted' | 'flat';
}

const TONE_CLASSES: Record<GlassTone, string> = {
  clear: 'bg-white/[0.48] [data-theme=aurora]:bg-white/[0.48]',
  tinted: 'bg-white/[0.36]',
  sunken: 'bg-black/[0.04]',
};

const SHADOW_CLASSES: Record<NonNullable<GlassOptions['shadow']>, string> = {
  soft: 'shadow-[inset_0_1px_0_0_rgba(255,255,255,.9),inset_0_-1px_0_0_rgba(20,19,26,.06),0_8px_32px_-12px_rgba(20,19,26,.18),0_2px_6px_-2px_rgba(20,19,26,.08)]',
  lifted:
    'shadow-[inset_0_1px_0_0_rgba(255,255,255,.95),inset_0_-1px_0_0_rgba(20,19,26,.07),0_22px_60px_-22px_rgba(20,19,26,.32),0_6px_16px_-8px_rgba(20,19,26,.18)]',
  flat: 'shadow-[inset_0_1px_0_0_rgba(255,255,255,.9),inset_0_-1px_0_0_rgba(20,19,26,.05)]',
};

// Pure class-string composer — used by components that don't need the LiquidGlass wrapper.
// Border radius is applied inline via `style` because Tailwind's JIT cannot statically
// generate every numeric rounding value at runtime.
export function glassClasses(opts: GlassOptions = {}): string {
  const { tone = 'clear', refract = false, bordered = true, shadow = 'soft' } = opts;
  return cn(
    'relative isolate overflow-hidden',
    bordered && 'border border-white/60',
    TONE_CLASSES[tone],
    SHADOW_CLASSES[shadow],
    refract
      ? '[backdrop-filter:blur(24px)_saturate(180%)_url(#lg-refract)] [-webkit-backdrop-filter:blur(24px)_saturate(180%)]'
      : '[backdrop-filter:blur(24px)_saturate(180%)] [-webkit-backdrop-filter:blur(24px)_saturate(180%)]'
  );
}

export function glassRadiusStyle(radius = 28): { borderRadius: string } {
  return { borderRadius: `${radius}px` };
}
