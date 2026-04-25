import React from 'react';
import { motion } from 'motion/react';

import type { ResolvedTeamMember, TeamTaskWithKanban } from '@shared/types/team';

import { useStore } from '@renderer/store';

import { LiquidGlass } from '../LiquidGlass';
import { Mascot, inferMascotRole, inferMascotStatus, type MascotStatus } from '../Mascot';
import { useAuroraTeam } from '../hooks/useAuroraTeam';

interface AgentMember {
  name: string;
  role: string;
  status: MascotStatus;
  currentTask: string;
  tasksDone: number;
  tasksTotal: number;
}

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

interface AgentRosterProps {
  onMemberClick?: (memberName: string) => void;
  onSendMessage?: (memberName: string) => void;
}

// Glass-card list of agents in the current team. Replaces the dark MemberList
// skin without touching the underlying member data or its hover-card hookups.
// When no team is loaded, shows an empty state.
export const AgentRoster = ({
  onMemberClick,
  onSendMessage,
}: AgentRosterProps): React.JSX.Element => {
  const { members, teamName, totalCount } = useAuroraTeam();
  const tasks = useStore((s) => s.selectedTeamData?.tasks ?? []);
  const cards = members.map((m) => toAgentMember(m, tasks));

  return (
    <LiquidGlass radius={26} className="flex flex-col gap-3 p-4">
      <header className="flex items-baseline justify-between px-1">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
          Roster
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--ink-3)]">
          {totalCount}
        </span>
      </header>

      {members.length === 0 ? (
        <p className="px-1 py-4 text-center text-[12px] text-[color:var(--ink-3)]">
          No agents yet. Create a team to get started.
        </p>
      ) : (
        <>
          <p className="px-1 text-[12px] text-[color:var(--ink-3)]">
            {`Active in ${teamName ?? 'this team'}.`}
          </p>
          <ul className="flex flex-col gap-2">
            {cards.map((m, idx) => (
              <motion.li
                key={m.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: APPLE_EASE, delay: idx * 0.04 }}
              >
                <RosterCard
                  member={m}
                  onMemberClick={onMemberClick}
                  onSendMessage={onSendMessage}
                />
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </LiquidGlass>
  );
};

const INACTIVE_STATUSES: MascotStatus[] = ['idle'];

const RosterCard = ({
  member,
  onMemberClick,
  onSendMessage,
}: {
  member: AgentMember;
  onMemberClick?: (memberName: string) => void;
  onSendMessage?: (memberName: string) => void;
}): React.JSX.Element => {
  const role = inferMascotRole(member.role);
  const progress = member.tasksTotal === 0 ? 0 : Math.min(1, member.tasksDone / member.tasksTotal);
  const isInactive = INACTIVE_STATUSES.includes(member.status);

  return (
    <div
      onClick={() => onMemberClick?.(member.name)}
      role={onMemberClick ? 'button' : undefined}
      tabIndex={onMemberClick ? 0 : undefined}
      onKeyDown={
        onMemberClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onMemberClick(member.name);
              }
            }
          : undefined
      }
      className={
        'group flex flex-col gap-3 rounded-[18px] border border-white/55 bg-white/55 p-3 transition-all duration-300 hover:-translate-y-px hover:bg-white/65 hover:shadow-[0_10px_24px_-12px_rgba(20,19,26,0.18)]' +
        (onMemberClick ? ' cursor-pointer' : '') +
        (isInactive ? ' opacity-70' : '')
      }
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }}
    >
      <div className="flex items-start gap-3">
        <Mascot role={role} size={48} seed={member.name} status={member.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-medium text-[color:var(--ink-1)]">
              {member.name}
            </p>
            <div className="flex items-center gap-1">
              {onSendMessage && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendMessage(member.name);
                  }}
                  aria-label={`Send message to ${member.name}`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--ink-3)] opacity-0 transition-opacity hover:bg-white/60 hover:text-[color:var(--ink-1)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] group-hover:opacity-100"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
                  </svg>
                </button>
              )}
              <StatusChip status={member.status} />
            </div>
          </div>
          <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
            {member.role}
          </p>
          <p className="mt-1.5 line-clamp-2 text-[12px] text-[color:var(--ink-2)]">
            {member.currentTask}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-sunk)]">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: 'linear-gradient(90deg, var(--a-violet), var(--a-cyan))' }}
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.7, ease: APPLE_EASE }}
          />
        </div>
        <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--ink-3)]">
          {member.tasksDone}/{member.tasksTotal}
        </span>
      </div>
    </div>
  );
};

const STATUS_LABEL: Record<MascotStatus, string> = {
  idle: 'Inactive',
  thinking: 'Thinking',
  coding: 'Coding',
  blocked: 'Blocked',
  done: 'Done',
  waiting: 'Waiting',
};

const STATUS_TINT: Record<MascotStatus, string> = {
  idle: 'rgba(20,19,26,0.06)',
  thinking: 'rgba(61,198,255,0.16)',
  coding: 'rgba(46,204,113,0.18)',
  blocked: 'rgba(255,90,90,0.18)',
  done: 'rgba(46,204,113,0.18)',
  waiting: 'rgba(255,176,32,0.20)',
};

const STATUS_INK: Record<MascotStatus, string> = {
  idle: 'var(--ink-3)',
  thinking: '#0E6FA0',
  coding: '#1A8A4A',
  blocked: '#A4262C',
  done: '#1A8A4A',
  waiting: '#9C6A0B',
};

const StatusChip = ({ status }: { status: MascotStatus }): React.JSX.Element => (
  <span
    className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium uppercase tracking-[0.08em]"
    style={{ background: STATUS_TINT[status], color: STATUS_INK[status] }}
  >
    <span
      aria-hidden="true"
      className="inline-flex h-1.5 w-1.5 rounded-full"
      style={{ background: STATUS_INK[status] }}
    />
    {STATUS_LABEL[status]}
  </span>
);

function toAgentMember(member: ResolvedTeamMember, tasks: TeamTaskWithKanban[]): AgentMember {
  const status = inferMascotStatus(member.status as unknown as string) ?? 'idle';
  const total = member.taskCount ?? 0;
  const tasksDone = tasks.filter((t) => t.owner === member.name && t.status === 'completed').length;
  return {
    name: member.name,
    role: member.role ?? member.agentType ?? 'Agent',
    status,
    currentTask: member.currentTaskId
      ? `Task ${member.currentTaskId.slice(0, 8)}`
      : status === 'idle'
        ? 'Awaiting task'
        : 'Working',
    tasksDone,
    tasksTotal: total,
  };
}
