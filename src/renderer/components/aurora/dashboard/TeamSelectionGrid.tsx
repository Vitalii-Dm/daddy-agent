import React from 'react';
import { motion } from 'motion/react';

import type { TeamSummary } from '@shared/types';
import { useStore } from '@renderer/store';

import { LiquidGlass } from '../LiquidGlass';
import { Mascot, inferMascotRole } from '../Mascot';

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

export const TeamSelectionGrid = (): React.JSX.Element => {
  const teams = useStore((s) => s.teams);
  const selectTeam = useStore((s) => s.selectTeam);

  const visibleTeams = teams.filter((t) => !t.deletedAt);

  if (visibleTeams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[color:var(--ink-3)]">
          No teams yet
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--ink-3)]">Create a team to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {visibleTeams.map((team, i) => (
        <motion.div
          key={team.teamName}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: APPLE_EASE, delay: i * 0.05 }}
        >
          <TeamCard team={team} onSelect={() => void selectTeam(team.teamName)} />
        </motion.div>
      ))}
    </div>
  );
};

interface TeamCardProps {
  team: TeamSummary;
  onSelect: () => void;
}

const TeamCard = ({ team, onSelect }: TeamCardProps): React.JSX.Element => {
  const memberSlice = (team.members ?? []).slice(0, 5);
  const overflow = (team.memberCount ?? 0) - memberSlice.length;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
      style={{ borderRadius: 26 }}
    >
      <LiquidGlass
        radius={26}
        className="relative flex h-full flex-col gap-3 p-5 transition-shadow duration-300 group-hover:shadow-[0_20px_44px_-20px_rgba(20,19,26,0.28)]"
      >
        {/* Team color accent bar */}
        {team.color && (
          <span
            aria-hidden="true"
            className="absolute left-5 top-0 h-[3px] w-12 rounded-b-full"
            style={{ background: team.color }}
          />
        )}

        {/* Team name */}
        <div className="mt-1 min-w-0">
          <p className="truncate text-[15px] font-semibold text-[color:var(--ink-1)]">
            {team.displayName || team.teamName}
          </p>
          {team.description ? (
            <p className="mt-0.5 line-clamp-2 text-[12px] text-[color:var(--ink-3)]">
              {team.description}
            </p>
          ) : null}
        </div>

        {/* Member avatars */}
        {memberSlice.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="flex -space-x-2">
              {memberSlice.map((m) => (
                <Mascot
                  key={m.name}
                  role={inferMascotRole(m.role)}
                  size={24}
                  seed={m.name}
                  ariaLabel={m.name}
                />
              ))}
            </div>
            {overflow > 0 && (
              <span className="font-mono text-[10.5px] text-[color:var(--ink-3)]">+{overflow}</span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3">
          <Stat label="members" value={team.memberCount} />
          <Stat label="tasks" value={team.taskCount} />
          {team.lastActivity && (
            <span className="font-mono text-[10px] text-[color:var(--ink-4)]">
              {formatRelative(team.lastActivity)}
            </span>
          )}
        </div>

        {/* Launch label — appears on hover */}
        <div className="absolute inset-x-5 bottom-5 translate-y-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <span className="inline-flex h-7 items-center rounded-full bg-[color:var(--a-violet)] px-3 text-[11px] font-medium text-white shadow-[0_4px_12px_-4px_rgba(124,92,255,0.55)]">
            Open dashboard
          </span>
        </div>
        {/* Spacer so the card height accommodates the hover label */}
        <div className="h-7 opacity-0" aria-hidden="true" />
      </LiquidGlass>
    </button>
  );
};

const Stat = ({ label, value }: { label: string; value: number }): React.JSX.Element => (
  <span className="flex items-center gap-1">
    <span className="font-mono text-[12px] font-medium tabular-nums text-[color:var(--ink-1)]">
      {value}
    </span>
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
      {label}
    </span>
  </span>
);

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}
