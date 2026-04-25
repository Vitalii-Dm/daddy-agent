import React, { useEffect, useState } from 'react';

import { useStore } from '@renderer/store';

import { InsightsBadge } from './InsightsBadge';
import { LiquidGlass } from './LiquidGlass';
import { useAuroraTeam } from './hooks/useAuroraTeam';

const SHRINK_AT = 80;

// Glass pill anchored to the top of the viewport. Width and padding
// breathe in/out as the user scrolls past the hero — handled with a
// resize-aware listener instead of motion's useScroll because this
// element lives outside any scrollable container at this stage.
export const TopRail = (): React.JSX.Element => {
  const { teamName, runningCount, totalCount, isAlive } = useAuroraTeam();
  const isDemo = useStore((s) => Boolean(s.selectedTeamData?.isDemo));
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

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Create task"
            onClick={() => window.dispatchEvent(new CustomEvent('aurora:create-task'))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--ink-2)] transition-colors hover:bg-white/10 hover:text-[color:var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M7 2v10M2 7h10"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Open chat"
            onClick={() => window.dispatchEvent(new CustomEvent('aurora:open-chat'))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--ink-2)] transition-colors hover:bg-white/10 hover:text-[color:var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M2 2.5A1.5 1.5 0 0 1 3.5 1h7A1.5 1.5 0 0 1 12 2.5v6A1.5 1.5 0 0 1 10.5 10H8l-3 3v-3H3.5A1.5 1.5 0 0 1 2 8.5v-6Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="mx-1 h-4 w-px bg-[color:var(--glass-shade)]" aria-hidden="true" />
          <InsightsBadge />
        </div>

        {isDemo ? (
          <span
            className="border-[color:var(--a-violet)]/40 bg-[color:var(--a-violet)]/15 flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium text-[color:var(--a-violet)]"
            title="Demo team — no live agents, all data is fixture"
          >
            <span aria-hidden="true">✨</span>
            <span className="font-mono uppercase tracking-[0.14em]">Demo · fake data</span>
          </span>
        ) : (
          <span className="flex items-center gap-2.5 whitespace-nowrap text-[12px] text-[color:var(--ink-2)]">
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
        )}
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
