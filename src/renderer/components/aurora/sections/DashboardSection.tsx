import React, { useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

import { ActivityStream } from '../dashboard/ActivityStream';
import { AgentRoster } from '../dashboard/AgentRoster';
import { KanbanGlass } from '../dashboard/KanbanGlass';
import { LiquidGlass } from '../LiquidGlass';
import { useAuroraTeam } from '../hooks/useAuroraTeam';

const VIEW_TABS = ['Kanban', 'List', 'Graph'] as const;
type ViewTab = (typeof VIEW_TABS)[number];

const FILTER_CHIPS = ['All', 'In progress', 'Review', 'Blocked'] as const;
type FilterChip = (typeof FILTER_CHIPS)[number];

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

// Three-column dashboard surface. The center column hosts the kanban —
// horizontal scroll is contained inside it so the page never gains a
// horizontal scrollbar at the document level. Side panels stick to top: 88px
// once the user scrolls past the header.
export const DashboardSection = (): React.JSX.Element => {
  const { teamName, runningCount, totalCount } = useAuroraTeam();
  const [view, setView] = useState<ViewTab>('Kanban');
  const [filter, setFilter] = useState<FilterChip>('All');
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'start center'],
  });
  const riseY = useTransform(scrollYProgress, [0, 1], [40, 0]);
  const riseScale = useTransform(scrollYProgress, [0, 1], [0.96, 1]);
  const riseOpacity = useTransform(scrollYProgress, [0, 1], [0.4, 1]);

  return (
    <section
      ref={sectionRef}
      id="dashboard"
      className="relative px-6 pb-32 pt-24 sm:px-10 lg:px-16"
      style={{ scrollMarginTop: '88px' }}
    >
      <motion.div
        className="mx-auto w-full max-w-[1480px]"
        style={
          reduceMotion
            ? undefined
            : { y: riseY, scale: riseScale, opacity: riseOpacity, transformOrigin: 'top center' }
        }
      >
        <DashboardHeader
          teamName={teamName}
          runningCount={runningCount}
          totalCount={totalCount}
          view={view}
          onViewChange={setView}
          filter={filter}
          onFilterChange={setFilter}
        />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.65, ease: APPLE_EASE }}
          className="mt-10 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_320px]"
        >
          <div className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-1">
            <AgentRoster />
          </div>

          <div className="min-w-0">
            <KanbanGlass filter={filter} view={view} />
          </div>

          <div className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pl-1">
            <ActivityStream />
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
};

interface DashboardHeaderProps {
  teamName: string | null;
  runningCount: number;
  totalCount: number;
  view: ViewTab;
  onViewChange: (v: ViewTab) => void;
  filter: FilterChip;
  onFilterChange: (f: FilterChip) => void;
}

const DashboardHeader = ({
  teamName,
  runningCount,
  totalCount,
  view,
  onViewChange,
  filter,
  onFilterChange,
}: DashboardHeaderProps): React.JSX.Element => (
  <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[color:var(--ink-3)]">
        {teamName ?? 'No team selected'}
      </p>
      <h2
        className="mt-3 truncate font-serif font-normal text-[color:var(--ink-1)]"
        style={{
          fontSize: 'clamp(36px, 4vw, 56px)',
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
        }}
      >
        Your agents, right now.
      </h2>
      <p className="mt-2 text-[14px] text-[color:var(--ink-2)]">
        {totalCount === 0
          ? 'Spin up a team to fill this surface.'
          : `${runningCount} of ${totalCount} ${totalCount === 1 ? 'agent' : 'agents'} working in parallel.`}
      </p>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <FilterChips value={filter} onChange={onFilterChange} />
      <ViewTabs value={view} onChange={onViewChange} />
    </div>
  </div>
);

const FilterChips = ({
  value,
  onChange,
}: {
  value: FilterChip;
  onChange: (v: FilterChip) => void;
}): React.JSX.Element => (
  <LiquidGlass radius={999} className="flex items-center gap-1 p-1">
    {FILTER_CHIPS.map((chip) => {
      const active = chip === value;
      return (
        <button
          key={chip}
          type="button"
          onClick={() => onChange(chip)}
          className={
            'relative inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ink-2)] ' +
            (active
              ? 'text-[color:var(--ink-1)]'
              : 'text-[color:var(--ink-3)] hover:text-[color:var(--ink-1)]')
          }
        >
          {active && (
            <motion.span
              layoutId="aurora-filter-pill"
              className="absolute inset-0 rounded-full bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_8px_-4px_rgba(20,19,26,0.18)]"
              transition={{ duration: 0.32, ease: APPLE_EASE }}
            />
          )}
          <span className="relative z-10">{chip}</span>
        </button>
      );
    })}
  </LiquidGlass>
);

const ViewTabs = ({
  value,
  onChange,
}: {
  value: ViewTab;
  onChange: (v: ViewTab) => void;
}): React.JSX.Element => (
  <LiquidGlass radius={14} className="flex items-center gap-1 p-1">
    {VIEW_TABS.map((tab) => {
      const active = tab === value;
      return (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={
            'relative inline-flex h-8 items-center rounded-[10px] px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ink-2)] ' +
            (active ? 'text-white' : 'text-[color:var(--ink-2)] hover:text-[color:var(--ink-1)]')
          }
        >
          {active && (
            <motion.span
              layoutId="aurora-view-pill"
              className="absolute inset-0 rounded-[10px]"
              style={{
                background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
                boxShadow: '0 6px 18px -8px rgba(124,92,255,0.45)',
              }}
              transition={{ duration: 0.32, ease: APPLE_EASE }}
            />
          )}
          <span className="relative z-10">{tab}</span>
        </button>
      );
    })}
  </LiquidGlass>
);
