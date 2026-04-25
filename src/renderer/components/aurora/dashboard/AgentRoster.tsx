import React from 'react';
import { motion } from 'motion/react';

import type { ResolvedTeamMember, TeamProviderId, TeamTaskWithKanban } from '@shared/types/team';

import { ProviderBrandLogo } from '@renderer/components/common/ProviderBrandLogo';
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
  providerId?: TeamProviderId;
  model?: string;
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
    <LiquidGlass radius={22} className="flex flex-col gap-2 p-3">
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
          <ul className="glass-scroll flex gap-3 overflow-x-auto pb-1">
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
          {teamName && (
            <p className="px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-4)]">
              {`Active in ${teamName}`}
            </p>
          )}
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

  const progressPct = Math.round(progress * 100);
  const taskLine =
    member.tasksTotal > 0
      ? `${member.tasksDone}/${member.tasksTotal} · ${progressPct}%`
      : member.role;

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
      title={member.currentTask}
      className={
        'glass-inner group relative flex h-[96px] w-[200px] shrink-0 items-center gap-3 overflow-hidden rounded-[16px] transition-all duration-200 hover:scale-[1.015]' +
        (onMemberClick ? ' cursor-pointer' : '') +
        (isInactive ? ' opacity-70' : '')
      }
      style={{ padding: '12px 16px' }}
    >
      <Mascot role={role} size={32} seed={member.name} status={member.status} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <p className="truncate text-[14px] font-medium leading-tight text-[color:var(--ink-1)]">
          {member.name}
        </p>
        <p className="truncate font-mono text-[12px] tabular-nums text-[color:var(--ink-2)]">
          {taskLine}
        </p>
      </div>
      {onSendMessage && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSendMessage(member.name);
          }}
          aria-label={`Send message to ${member.name}`}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[color:var(--ink-3)] opacity-0 transition-opacity hover:bg-white/60 hover:text-[color:var(--ink-1)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] group-hover:opacity-100"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M2 2h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
          </svg>
        </button>
      )}
      <div
        className="pointer-events-none absolute bottom-0 left-4 right-4 h-[2px] overflow-hidden rounded-full"
        style={{ background: 'rgba(20,19,26,0.06)' }}
      >
        <motion.div
          className="h-full"
          style={{
            background: 'linear-gradient(90deg, var(--a-violet), var(--a-cyan))',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.6, ease: APPLE_EASE }}
        />
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

const PROVIDER_LABEL: Record<TeamProviderId, string> = {
  anthropic: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

const PROVIDER_TINT: Record<TeamProviderId, string> = {
  anthropic: 'rgba(217, 119, 87, 0.16)',
  codex: 'rgba(20, 19, 26, 0.08)',
  gemini: 'rgba(66, 133, 244, 0.18)',
};

const PROVIDER_INK: Record<TeamProviderId, string> = {
  anthropic: '#A5552B',
  codex: 'var(--ink-2)',
  gemini: '#1A57C8',
};

const ProviderChip = ({
  providerId,
  model,
}: {
  providerId: TeamProviderId;
  model?: string;
}): React.JSX.Element => (
  <span
    className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none"
    style={{ background: PROVIDER_TINT[providerId], color: PROVIDER_INK[providerId] }}
    title={model ? `${PROVIDER_LABEL[providerId]} · ${model}` : PROVIDER_LABEL[providerId]}
  >
    <ProviderBrandLogo providerId={providerId} className="h-3 w-3" />
    {PROVIDER_LABEL[providerId]}
  </span>
);

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
    providerId: member.providerId,
    model: member.model,
  };
}
