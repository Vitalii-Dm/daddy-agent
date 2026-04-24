import React, { useEffect, useState } from 'react';

import { LiquidGlass } from './LiquidGlass';
import { useAuroraTeam } from './hooks/useAuroraTeam';

const SHRINK_AT = 80;

// Glass pill anchored to the top of the viewport. Width and padding
// breathe in/out as the user scrolls past the hero — handled with a
// resize-aware listener instead of motion's useScroll because this
// element lives outside any scrollable container at this stage.
export const TopRail = (): React.JSX.Element => {
  const { teamName, runningCount, totalCount, isAlive } = useAuroraTeam();
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onScroll = (): void => {
      // Coalesce to a single rAF so Lenis-driven smooth scroll doesn't churn state.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setShrunk(window.scrollY > SHRINK_AT));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const breadcrumb = teamName ? `Home · ${teamName}` : 'Home · Agents';
  const statusLabel =
    totalCount === 0
      ? 'Standby'
      : `${runningCount}/${totalCount} ${runningCount === 1 ? 'agent' : 'agents'} running`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-40 flex justify-center px-6">
      <LiquidGlass
        as="nav"
        refract
        radius={999}
        shadow="lifted"
        className="pointer-events-auto flex items-center gap-4 px-5 py-2.5 transition-[width,padding,backdrop-filter] duration-500"
        style={{
          width: 'min(100%, ' + (shrunk ? '540px' : '920px') + ')',
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--ink-1)]">
          <LogoMark />
          <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--ink-2)]">
            daddy.agent
          </span>
        </span>

        <span
          className="hidden h-4 w-px bg-[color:var(--glass-shade)] sm:block"
          aria-hidden="true"
        />

        <span className="hidden flex-1 truncate text-center text-[13px] text-[color:var(--ink-2)] sm:block">
          {breadcrumb}
        </span>

        <span className="ml-auto flex items-center gap-2.5 whitespace-nowrap text-[12px] text-[color:var(--ink-2)]">
          <span
            className={
              'inline-flex h-2 w-2 rounded-full ' +
              (isAlive
                ? 'bg-[color:var(--ok)] shadow-[0_0_0_4px_rgba(46,204,113,0.18)]'
                : 'bg-[color:var(--ink-4)]')
            }
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.1em]">{statusLabel}</span>
        </span>
      </LiquidGlass>
    </div>
  );
};

const LogoMark = (): React.JSX.Element => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="aurora-logo" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--a-violet)" />
        <stop offset="1" stopColor="var(--a-cyan)" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#aurora-logo)" />
    <circle cx="9" cy="9" r="2.2" fill="white" opacity="0.95" />
    <circle cx="15" cy="9" r="2.2" fill="white" opacity="0.75" />
    <circle cx="12" cy="15" r="2.4" fill="white" opacity="0.85" />
  </svg>
);
