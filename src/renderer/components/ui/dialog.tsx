/* eslint-disable react/jsx-props-no-spreading -- Standard shadcn pattern: forward remaining props to underlying elements */
import * as React from 'react';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@renderer/lib/utils';
import { X } from 'lucide-react';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

// Glass dialog overlay — quiet ink scrim + 14px backdrop blur per the
// v3/v4 spec. The dashboard underneath stays visible but defocused so
// the modal reads as a glass surface lifted off the canvas, not as a
// dark blackout.
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    style={{
      background: 'rgba(20, 19, 26, 0.18)',
      backdropFilter: 'blur(14px) saturate(120%)',
      WebkitBackdropFilter: 'blur(14px) saturate(120%)',
      ...style,
    }}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Glass dialog panel — white/65 fill, 40px blur + 190% saturation,
// chromatic edge inset, lifted shadow, 28px radius. Replaces the solid
// var(--color-surface) panel so every dialog in the app reads as a
// glass card lifted off the canvas.
const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="pointer-events-auto relative">
        <DialogPrimitive.Close
          className="absolute -right-3 -top-3 z-10 grid size-8 place-items-center rounded-full border border-white/70 text-[color:var(--ink-2)] opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[color:var(--a-violet)] disabled:pointer-events-none"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(18px) saturate(180%)',
            WebkitBackdropFilter: 'blur(18px) saturate(180%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), 0 6px 16px -8px rgba(20,19,26,0.25)',
          }}
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
        <DialogPrimitive.Content
          ref={ref}
          data-lenis-prevent
          className={cn(
            'relative isolate grid w-full max-w-lg gap-4 p-6 duration-200',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'max-h-[90vh] min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain',
            'focus:outline-none',
            'glass-scroll',
            className
          )}
          style={{
            borderRadius: 28,
            border: '1px solid rgba(255, 255, 255, 0.7)',
            background: 'rgba(255, 255, 255, 0.65)',
            backdropFilter: 'blur(40px) saturate(190%)',
            WebkitBackdropFilter: 'blur(40px) saturate(190%)',
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(20,19,26,0.07), 0 28px 80px -28px rgba(20,19,26,0.38), 0 8px 22px -10px rgba(20,19,26,0.18)',
            color: 'var(--ink-1)',
            ...style,
          }}
          {...props}
        >
          {/* Top inner specular — gives the panel its glass curvature
              reading. Sits behind content via z-0 / pointer-events-none. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 top-px z-0 h-12 rounded-full"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%)',
            }}
          />
          {/* Subtle chromatic edge — the "Apple engineer" detail. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              borderRadius: 28,
              boxShadow:
                'inset 0.5px 0.5px 0 0 rgba(255, 90, 120, 0.45), inset -0.5px -0.5px 0 0 rgba(80, 200, 255, 0.45)',
              opacity: 0.6,
            }}
          />
          <div className="relative z-10 grid gap-4">{children}</div>
        </DialogPrimitive.Content>
      </div>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-[22px] font-medium leading-tight tracking-[-0.01em] text-[color:var(--ink-1)]',
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[13px] leading-relaxed text-[color:var(--ink-3)]', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
/* eslint-enable react/jsx-props-no-spreading -- Re-enable after shadcn component */
