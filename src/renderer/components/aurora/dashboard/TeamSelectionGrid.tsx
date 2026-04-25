import React, { useState } from 'react';
import { motion } from 'motion/react';

import { formatRelativeTime } from '@renderer/utils/formatters';
import type { TeamSummary } from '@shared/types/team';

import { LiquidGlass } from '../LiquidGlass';
import { inferMascotRole, Mascot } from '../Mascot';

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

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
  const activeTeams = teams.filter((t) => !t.deletedAt && !t.pendingCreate);

  if (activeTeams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="14" stroke="var(--ink-3)" strokeWidth="1.5" />
            <path
              d="M16 10v6M16 20h.01"
              stroke="var(--ink-3)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div>
          <p className="text-[18px] font-medium text-[color:var(--ink-1)]">No teams yet</p>
          <p className="mt-1 text-[14px] text-[color:var(--ink-3)]">
            Create your first agent team to get started
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateTeam}
          className="inline-flex items-center gap-2 rounded-full bg-[color:var(--a-violet)] px-6 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
        >
          <span aria-hidden="true" className="text-[16px] leading-none">
            +
          </span>
          Create Team
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {activeTeams.map((team, i) => (
        <motion.div
          key={team.teamName}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: APPLE_EASE, delay: i * 0.06 }}
        >
          <TeamCard
            team={team}
            onSelect={() => onSelectTeam(team.teamName)}
            onLaunch={() => onLaunchTeam(team.teamName)}
          />
        </motion.div>
      ))}

      {/* New Team card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: APPLE_EASE, delay: activeTeams.length * 0.06 }}
      >
        <button
          type="button"
          onClick={onCreateTeam}
          className="hover:border-[color:var(--a-violet)]/50 group flex h-full min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed border-[color:var(--glass-shade)] bg-white/5 text-[color:var(--ink-3)] transition-colors hover:bg-white/10 hover:text-[color:var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-current transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 4v12M4 10h12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="text-[13px] font-medium">New Team</span>
        </button>
      </motion.div>
    </div>
  );
};

interface TeamCardProps {
  team: TeamSummary;
  onSelect: () => void;
  onLaunch: () => void;
}

const TeamCard = ({ team, onSelect, onLaunch }: TeamCardProps): React.JSX.Element => {
  const [hovered, setHovered] = useState(false);

  const accentColor = team.color ?? 'var(--a-violet)';
  const displayMembers = (team.members ?? []).slice(0, 5);
  const extraCount = (team.memberCount ?? 0) - displayMembers.length;

  const shortPath = team.projectPath ? team.projectPath.replace(/^\/Users\/[^/]+/, '~') : null;

  const lastActivityLabel = team.lastActivity
    ? formatRelativeTime(team.lastActivity)
    : 'No activity';

  return (
    <LiquidGlass
      radius={20}
      className="relative flex cursor-pointer flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_32px_-8px_rgba(20,19,26,0.25)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-label={`Open team ${team.displayName}`}
    >
      {/* Color accent bar */}
      <div
        className="h-1 w-full flex-shrink-0"
        style={{ background: accentColor }}
        aria-hidden="true"
      />

      <div className="flex flex-1 flex-col gap-3 p-5">
        {/* Team name + description */}
        <div>
          <h3 className="truncate text-[15px] font-semibold text-[color:var(--ink-1)]">
            {team.displayName}
          </h3>
          {team.description && (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[color:var(--ink-3)]">
              {team.description}
            </p>
          )}
        </div>

        {/* Member avatars */}
        {displayMembers.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex -space-x-2">
              {displayMembers.map((m) => (
                <div
                  key={m.name}
                  className="rounded-full ring-2 ring-[color:var(--bg-base)]"
                  title={m.name}
                >
                  <Mascot role={inferMascotRole(m.role)} size={24} seed={m.name} />
                </div>
              ))}
            </div>
            {extraCount > 0 && (
              <span className="ml-1 text-[11px] text-[color:var(--ink-3)]">+{extraCount}</span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-4 text-[11px] text-[color:var(--ink-3)]">
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="6" cy="4.5" r="1.4" fill="currentColor" />
              <path
                d="M3 10c0-1.657 1.343-2.5 3-2.5s3 .843 3 2.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            {team.memberCount} {team.memberCount === 1 ? 'agent' : 'agents'}
          </span>
          <span className="flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect
                x="1"
                y="2"
                width="10"
                height="9"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M4 1v2M8 1v2M1 5h10"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            {team.taskCount} {team.taskCount === 1 ? 'task' : 'tasks'}
          </span>
          <span className="ml-auto truncate">{lastActivityLabel}</span>
        </div>

        {/* Project path */}
        {shortPath && (
          <p className="truncate font-mono text-[10px] text-[color:var(--ink-4)]">{shortPath}</p>
        )}
      </div>

      {/* Launch button — revealed on hover */}
      {hovered && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute inset-x-0 bottom-0 flex justify-center pb-4"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLaunch();
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--a-violet)] px-4 py-1.5 text-[11px] font-medium text-white shadow-[0_4px_12px_-4px_rgba(124,92,255,0.6)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path
                d="M2 5h6M5 2l3 3-3 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Launch
          </button>
        </motion.div>
      )}
    </LiquidGlass>
  );
};
