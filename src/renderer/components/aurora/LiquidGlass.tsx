import React, {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
  type CSSProperties,
} from 'react';

import { glassClasses, glassRadiusStyle, type GlassTone } from '@renderer/lib/glass';
import { cn } from '@renderer/lib/utils';

type LiquidGlassProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  tone?: GlassTone;
  refract?: boolean;
  radius?: number;
  bordered?: boolean;
  shadow?: 'soft' | 'lifted' | 'flat';
};

export const LiquidGlass = forwardRef<HTMLElement, LiquidGlassProps>(
  (
    {
      as: Tag = 'div',
      tone,
      refract,
      radius = 28,
      bordered,
      shadow,
      className,
      style,
      children,
      ...rest
    },
    ref
  ) => {
    const composedStyle: CSSProperties = { ...glassRadiusStyle(radius), ...style };
    return (
      <Tag
        ref={ref as never}
        className={cn(glassClasses({ tone, refract, bordered, shadow }), className)}
        style={composedStyle}
        {...rest}
      >
        {children}
      </Tag>
    );
  }
);

LiquidGlass.displayName = 'LiquidGlass';
