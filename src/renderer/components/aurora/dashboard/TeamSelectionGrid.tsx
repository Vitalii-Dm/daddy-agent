import React from 'react';

import { LiquidGlass } from '../LiquidGlass';
import { inferMascotRole, Mascot } from '../Mascot';

import type { TeamSummary } from '@shared/types';

interface TeamSelectionGridProps {
  teams: TeamSummary[];
  onSelectTeam: (teamName: string) => void;
  onCreateTeam: () => void;
  onLaunchTeam: (teamName: string) => void;
}

export const TeamSelectionGrid = ({
  teams,
  onSelectTeam,
  onCreateTeam,
  onLaunchTeam,
}: TeamSelectionGridProps): React.JSX.Element => {
  if (teams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center">
          <h3
            className="font-serif text-[28px] font-normal text-[color:var(--ink-1)]"
            style={{ letterSpacing: '-0.02em' }}
          >
            No teams yet
          </h3>
          <p className="mt-2 text-[14px] text-[color:var(--ink-3)]">
            Create your first team to get started.
          </p>
          <button
            type="button"
            onClick={onCreateTeam}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium text-white transition-transform hover:scale-[1.015]"
            style={{
              background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
              boxShadow: '0 8px 22px -10px rgba(124, 92, 255, 0.5)',
            }}
          >
            <span aria-hidden="true" className="text-[16px] leading-none">
              +
            </span>
            Create Team
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((team) => (
        <TeamCard
          key={team.teamName}
          team={team}
          onSelect={() => onSelectTeam(team.teamName)}
          onLaunch={() => onLaunchTeam(team.teamName)}
        />
      ))}
      {/* Create new team card */}
      <button
        type="button"
        onClick={onCreateTeam}
        className="group flex min-h-[180px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-white/20 transition-colors hover:border-white/40 hover:bg-white/5"
      >
        <span
          className="flex size-10 items-center justify-center rounded-full text-[20px] text-[color:var(--ink-3)] transition-colors group-hover:text-[color:var(--ink-1)]"
          style={{ background: 'var(--glass-fill)' }}
        >
          +
        </span>
        <span className="mt-2 text-[13px] font-medium text-[color:var(--ink-3)] group-hover:text-[color:var(--ink-1)]">
          New Team
        </span>
      </button>
    </div>
  );
};

const TEAM_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  purple: '#a855f7',
  cyan: '#06b6d4',
  orange: '#f97316',
  pink: '#ec4899',
};

const TeamCard = ({
  team,
  onSelect,
  onLaunch,
}: {
  team: TeamSummary;
  onSelect: () => void;
  onLaunch: () => void;
}): React.JSX.Element => {
  const accentColor = TEAM_COLORS[team.color ?? 'blue'] ?? TEAM_COLORS.blue;
  const memberNames = team.members?.map((m) => m.name) ?? [];
  const hasActivity = !!team.lastActivity;
  const timeAgo = hasActivity ? relativeTime(team.lastActivity!) : null;

  return (
    <LiquidGlass radius={24} className="group relative overflow-hidden">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full flex-col p-5 text-left transition-transform hover:scale-[1.01]"
      >
        {/* Color accent bar */}
        <div
          className="absolute left-0 top-0 h-1 w-full rounded-t-3xl"
          style={{ background: accentColor }}
        />

        {/* Team name + description */}
        <div className="mt-1">
          <h3 className="text-[15px] font-semibold text-[color:var(--ink-1)]">
            {team.displayName || team.teamName}
          </h3>
          {team.description && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[color:var(--ink-3)]">
              {team.description}
            </p>
          )}
        </div>

        {/* Members avatars */}
        {memberNames.length > 0 && (
          <div className="mt-3 flex items-center gap-1">
            {team.members!.slice(0, 5).map((member) => (
              <Mascot
                key={member.name}
                role={inferMascotRole(member.role)}
                size={24}
                seed={member.name}
              />
            ))}
            {memberNames.length > 5 && (
              <span className="ml-1 text-[11px] text-[color:var(--ink-3)]">
                +{memberNames.length - 5}
              </span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="mt-3 flex items-center gap-3 text-[11px] text-[color:var(--ink-3)]">
          <span>
            {team.memberCount} {team.memberCount === 1 ? 'agent' : 'agents'}
          </span>
          <span className="opacity-30">·</span>
          <span>
            {team.taskCount} {team.taskCount === 1 ? 'task' : 'tasks'}
          </span>
          {timeAgo && (
            <>
              <span className="opacity-30">·</span>
              <span>{timeAgo}</span>
            </>
          )}
        </div>

        {/* Project path */}
        {team.projectPath && (
          <p className="mt-2 truncate font-mono text-[10px] text-[color:var(--ink-3)] opacity-60">
            {team.projectPath.replace(/^\/Users\/[^/]+\//, '~/')}
          </p>
        )}
      </button>

      {/* Launch button overlay */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onLaunch();
        }}
        className="absolute right-3 top-4 flex h-7 items-center gap-1 rounded-full bg-emerald-500/20 px-3 text-[11px] font-medium text-emerald-400 opacity-0 transition-opacity hover:bg-emerald-500/30 group-hover:opacity-100"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M4 2.5v11l9-5.5z" />
        </svg>
        Launch
      </button>
    </LiquidGlass>
  );
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
