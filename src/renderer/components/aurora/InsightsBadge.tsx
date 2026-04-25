import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { getDemoMemberStats, isDemoTeamName } from '@renderer/utils/demoTeamFixture';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';

import type { MemberFullStats } from '@shared/types';

import { useAuroraTeam } from './hooks/useAuroraTeam';

interface AggregateStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  tasksCompleted: number;
  messageCount: number;
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  toolUsage: Record<string, number>;
  perMember: { name: string; stats: MemberFullStats }[];
}

const EMPTY_AGGREGATE: AggregateStats = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  tasksCompleted: 0,
  messageCount: 0,
  filesTouched: 0,
  linesAdded: 0,
  linesRemoved: 0,
  toolUsage: {},
  perMember: [],
};

const REFRESH_INTERVAL_MS = 8_000;

export const InsightsBadge = (): React.JSX.Element | null => {
  const { teamName, members } = useAuroraTeam();
  const messages = useStore((s) => s.selectedTeamData?.messages ?? []);
  const tasks = useStore((s) => s.selectedTeamData?.tasks ?? []);

  const [stats, setStats] = useState<AggregateStats>(EMPTY_AGGREGATE);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  // Aggregate per-member stats. Refresh on a steady cadence so the demo shows live numbers.
  useEffect(() => {
    if (!teamName || members.length === 0) {
      setStats(EMPTY_AGGREGATE);
      return;
    }

    let cancelled = false;
    const isDemo = isDemoTeamName(teamName);
    const load = async (): Promise<void> => {
      try {
        const results = await Promise.all(
          members.map(async (m) => {
            if (isDemo) {
              const fixture = getDemoMemberStats(m.name);
              return fixture ? { name: m.name, stats: fixture } : null;
            }
            try {
              const s = await api.teams.getMemberStats(teamName, m.name);
              return { name: m.name, stats: s };
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        const valid = results.filter(
          (r): r is { name: string; stats: MemberFullStats } => r !== null
        );
        const agg = valid.reduce<AggregateStats>(
          (acc, { name, stats: s }) => {
            acc.inputTokens += s.inputTokens;
            acc.outputTokens += s.outputTokens;
            acc.cacheReadTokens += s.cacheReadTokens;
            acc.costUsd += s.costUsd;
            acc.tasksCompleted += s.tasksCompleted;
            acc.messageCount += s.messageCount;
            acc.linesAdded += s.linesAdded;
            acc.linesRemoved += s.linesRemoved;
            for (const f of s.filesTouched) {
              acc.filesTouched += 1;
              void f;
            }
            for (const [tool, count] of Object.entries(s.toolUsage)) {
              acc.toolUsage[tool] = (acc.toolUsage[tool] ?? 0) + count;
            }
            acc.perMember.push({ name, stats: s });
            return acc;
          },
          {
            ...EMPTY_AGGREGATE,
            toolUsage: {},
            perMember: [],
          }
        );
        setStats(agg);
      } catch {
        // ignore — the badge falls back to its previous values
      }
    };

    void load();
    const id = window.setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [teamName, members]);

  // Approximate per-category token split from tool usage + message volume.
  // Real-deal categorization lives in the legacy ContextBadge; here we surface
  // demo-ready aggregates pulled from MemberFullStats so the surface stays live.
  const categoryBreakdown = useMemo(() => {
    const total = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens;
    if (total === 0) return [];
    const toolCount = Object.values(stats.toolUsage).reduce((a, b) => a + b, 0);
    const teamCoordCount =
      (stats.toolUsage['SendMessage'] ?? 0) +
      (stats.toolUsage['TaskCreate'] ?? 0) +
      (stats.toolUsage['TaskUpdate'] ?? 0) +
      (stats.toolUsage['TaskList'] ?? 0) +
      (stats.toolUsage['TaskGet'] ?? 0);
    const fileToolCount =
      (stats.toolUsage['Read'] ?? 0) +
      (stats.toolUsage['Write'] ?? 0) +
      (stats.toolUsage['Edit'] ?? 0);
    const userMsgWeight = Math.max(stats.messageCount - toolCount, 0);

    // Rough proportional split — driven by tool usage density. For demo purposes.
    const totalWeight = Math.max(toolCount + userMsgWeight + 1, 1);
    const toolShare = toolCount / totalWeight;
    const teamShare = totalWeight === 0 ? 0 : teamCoordCount / totalWeight;
    const fileShare = totalWeight === 0 ? 0 : fileToolCount / totalWeight;
    const userShare = userMsgWeight / totalWeight;
    const thinkShare = Math.max(0, 1 - toolShare - userShare);

    return [
      {
        label: 'Tool output',
        category: 'tool-output',
        tokens: Math.round(total * toolShare),
        accent: 'var(--a-cyan)',
      },
      {
        label: 'Thinking',
        category: 'thinking-text',
        tokens: Math.round(total * thinkShare * 0.7),
        accent: 'var(--a-violet)',
      },
      {
        label: 'Mentioned files',
        category: 'mentioned-file',
        tokens: Math.round(total * fileShare * 0.4),
        accent: '#7BD389',
      },
      {
        label: 'Team coord.',
        category: 'team-coordination',
        tokens: Math.round(total * teamShare * 1.5),
        accent: '#F4C95D',
      },
      {
        label: 'User prompts',
        category: 'user-message',
        tokens: Math.round(total * userShare * 0.9),
        accent: '#FF9DBD',
      },
      {
        label: 'CLAUDE.md',
        category: 'claude-md',
        tokens: Math.round(total * 0.05),
        accent: '#9AA0A6',
      },
    ].filter((c) => c.tokens > 0);
  }, [stats]);

  const totalTokens = stats.inputTokens + stats.outputTokens + stats.cacheReadTokens;
  const totalCostLabel =
    stats.costUsd >= 1
      ? `$${stats.costUsd.toFixed(2)}`
      : stats.costUsd > 0
        ? `$${stats.costUsd.toFixed(3)}`
        : '$0.00';

  // Position popover under the badge, recompute on open + window resize.
  useEffect(() => {
    if (!open) return;
    const update = (): void => {
      const anchor = containerRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = 320;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
      setPopoverStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left,
        width,
        zIndex: 60,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Click-outside to dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // CommandBar can request the popover be opened directly.
  useEffect(() => {
    const handler = (): void => setOpen(true);
    window.addEventListener('aurora:open-insights', handler);
    return () => window.removeEventListener('aurora:open-insights', handler);
  }, []);

  if (!teamName) return null;

  const totalTasksLabel = `${stats.tasksCompleted}/${tasks.length} tasks`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Open context insights"
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[color:var(--glass-shade)] bg-white/40 px-2.5 text-[11px] font-medium text-[color:var(--ink-1)] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 1 A5 5 0 0 1 11 6" stroke="var(--a-violet)" strokeWidth="1.6" fill="none" />
        </svg>
        <span className="font-mono tabular-nums">
          {totalTokens === 0 ? '0' : formatTokensCompact(totalTokens)}
        </span>
        <span className="hidden text-[color:var(--ink-3)] sm:inline">·</span>
        <span className="hidden font-mono tabular-nums text-[color:var(--ink-2)] sm:inline">
          {totalCostLabel}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            style={popoverStyle}
            className="rounded-2xl border border-[color:var(--glass-shade)] bg-white/85 p-4 shadow-[0_22px_40px_-22px_rgba(20,19,26,0.4)] backdrop-blur-xl"
          >
            <div className="mb-3 flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
                  Context window
                </p>
                <p className="mt-1 text-[20px] font-medium tabular-nums text-[color:var(--ink-1)]">
                  {formatTokensCompact(totalTokens)}{' '}
                  <span className="text-[12px] text-[color:var(--ink-3)]">tokens</span>
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
                  Spend
                </p>
                <p className="mt-1 text-[18px] font-medium tabular-nums text-[color:var(--ink-1)]">
                  {totalCostLabel}
                </p>
              </div>
            </div>

            {categoryBreakdown.length > 0 ? (
              <div className="space-y-2">
                {categoryBreakdown.map((row) => {
                  const pct = totalTokens === 0 ? 0 : (row.tokens / totalTokens) * 100;
                  return (
                    <div key={row.category}>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-[color:var(--ink-2)]">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: row.accent }}
                            aria-hidden="true"
                          />
                          <span>{row.label}</span>
                        </span>
                        <span className="font-mono tabular-nums text-[color:var(--ink-3)]">
                          {formatTokensCompact(row.tokens)} · {pct.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--glass-shade)]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: row.accent }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12px] text-[color:var(--ink-3)]">
                Token usage will appear once the team starts working.
              </p>
            )}

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[color:var(--glass-shade)] pt-3 text-[11px]">
              <Stat label="Tasks" value={totalTasksLabel} />
              <Stat label="Files" value={String(stats.filesTouched)} />
              <Stat label="Δ lines" value={`+${stats.linesAdded} / -${stats.linesRemoved}`} />
            </div>

            <p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
              Live · refreshes every {REFRESH_INTERVAL_MS / 1000}s · {messages.length} messages
            </p>
          </div>,
          document.body
        )}
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div>
    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
      {label}
    </p>
    <p className="font-mono text-[12px] tabular-nums text-[color:var(--ink-1)]">{value}</p>
  </div>
);
