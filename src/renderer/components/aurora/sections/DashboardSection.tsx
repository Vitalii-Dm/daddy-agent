import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';

import { isElectronMode } from '@renderer/api';
import { CreateTaskDialog } from '@renderer/components/team/dialogs/CreateTaskDialog';
import { CreateTeamDialog } from '@renderer/components/team/dialogs/CreateTeamDialog';
import { LaunchTeamDialog } from '@renderer/components/team/dialogs/LaunchTeamDialog';
import { SendMessageDialog } from '@renderer/components/team/dialogs/SendMessageDialog';
import { TaskDetailDialog } from '@renderer/components/team/dialogs/TaskDetailDialog';
import { TrashDialog } from '@renderer/components/team/kanban/TrashDialog';
import { MemberDetailDialog } from '@renderer/components/team/members/MemberDetailDialog';
import { useStore } from '@renderer/store';

import type { TaskRef } from '@shared/types/team';
import type { ResolvedTeamMember, TeamTaskWithKanban } from '@shared/types';

import { ActivityStream } from '../dashboard/ActivityStream';
import { AgentRoster } from '../dashboard/AgentRoster';
import { DashboardChat } from '../dashboard/DashboardChat';
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
  const { teamName, members, runningCount, totalCount, isAlive } = useAuroraTeam();
  const tasks = useStore((s) => s.selectedTeamData?.tasks ?? []);
  const messages = useStore((s) => s.selectedTeamData?.messages ?? []);
  const createTeamTask = useStore((s) => s.createTeamTask);

  const {
    sendTeamMessage,
    restoreTask,
    deletedTasks,
    fetchDeletedTasks,
    sendingMessage,
    sendMessageError,
    lastSendMessageResult,
    launchTeam,
    createTeam,
    provisioningErrorByTeam,
    clearProvisioningError,
    teams,
    openTeamTab,
    connectionMode,
  } = useStore(
    useShallow((s) => ({
      sendTeamMessage: s.sendTeamMessage,
      restoreTask: s.restoreTask,
      deletedTasks: s.deletedTasks,
      fetchDeletedTasks: s.fetchDeletedTasks,
      sendingMessage: s.sendingMessage,
      sendMessageError: s.sendMessageError,
      lastSendMessageResult: s.lastSendMessageResult,
      launchTeam: s.launchTeam,
      createTeam: s.createTeam,
      provisioningErrorByTeam: s.provisioningErrorByTeam,
      clearProvisioningError: s.clearProvisioningError,
      teams: s.teams,
      openTeamTab: s.openTeamTab,
      connectionMode: s.connectionMode,
    }))
  );

  const [view, setView] = useState<ViewTab>('Kanban');
  const [filter, setFilter] = useState<FilterChip>('All');
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendDialogRecipient, setSendDialogRecipient] = useState('');
  const [selectedTask, setSelectedTask] = useState<TeamTaskWithKanban | null>(null);
  const [selectedMember, setSelectedMember] = useState<ResolvedTeamMember | null>(null);
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'start center'],
  });
  const riseY = useTransform(scrollYProgress, [0, 1], [40, 0]);
  const riseScale = useTransform(scrollYProgress, [0, 1], [0.96, 1]);
  const riseOpacity = useTransform(scrollYProgress, [0, 1], [0.4, 1]);

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Load deleted tasks when a team is selected so trash dialog is ready.
  useEffect(() => {
    if (teamName) {
      void fetchDeletedTasks(teamName);
    }
  }, [teamName, fetchDeletedTasks]);

  // Listen for global events dispatched from the TopRail, HeroSection, and CommandBar.
  useEffect(() => {
    const onCreateTeam = (): void => setCreateTeamOpen(true);
    const onCreateTask = (): void => setCreateTaskOpen(true);
    window.addEventListener('aurora:create-team', onCreateTeam);
    window.addEventListener('aurora:create-task', onCreateTask);
    return () => {
      window.removeEventListener('aurora:create-team', onCreateTeam);
      window.removeEventListener('aurora:create-task', onCreateTask);
    };
  }, []);

  const electronMode = isElectronMode();
  const canCreate = electronMode && connectionMode === 'local';
  const existingTeamNames = useMemo(() => teams.map((t) => t.teamName), [teams]);
  const provisioningError = teamName ? (provisioningErrorByTeam[teamName] ?? null) : null;

  const handleCreateTask = (
    subject: string,
    description: string,
    owner?: string,
    blockedBy?: string[],
    related?: string[],
    prompt?: string,
    startImmediately?: boolean,
    descriptionTaskRefs?: TaskRef[],
    promptTaskRefs?: TaskRef[]
  ): void => {
    if (!teamName) return;
    setCreatingTask(true);
    void (async () => {
      try {
        await createTeamTask(teamName, {
          subject,
          description: description || undefined,
          owner,
          blockedBy,
          related,
          prompt,
          descriptionTaskRefs,
          promptTaskRefs,
          startImmediately,
        });
        setCreateTaskOpen(false);
      } catch {
        // error shown via store
      } finally {
        setCreatingTask(false);
      }
    })();
  };

  const handleMemberClick = (memberName: string): void => {
    const member = members.find((m) => m.name === memberName) ?? null;
    setSelectedMember(member);
  };

  const handleSendMessageFromActivity = (): void => {
    setSendDialogRecipient('');
    setSendDialogOpen(true);
  };

  return (
    <>
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
            onCreateTask={() => setCreateTaskOpen(true)}
            onLaunchTeam={() => setLaunchDialogOpen(true)}
            onNewTeam={() => setCreateTeamOpen(true)}
            onSendMessage={() => setSendDialogOpen(true)}
            onTrash={teamName ? () => setTrashOpen(true) : undefined}
          />

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.65, ease: APPLE_EASE }}
            className="mt-10 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)_320px]"
          >
            <div className="lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-1">
              <AgentRoster
                onMemberClick={handleMemberClick}
                onSendMessage={(name) => {
                  setSendDialogRecipient(name);
                  setSendDialogOpen(true);
                }}
              />
            </div>

            <div className="min-w-0">
              <KanbanGlass
                filter={filter}
                view={view}
                onTaskClick={(task) => setSelectedTask(task)}
                onCreateTask={() => setCreateTaskOpen(true)}
              />
            </div>

            <div className="flex flex-col gap-4 overflow-hidden lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:pl-1">
              <ActivityStream onSendMessage={handleSendMessageFromActivity} maxItems={4} />
              {teamName ? (
                <div className="min-h-0 flex-1">
                  <DashboardChat teamName={teamName} />
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      </section>

      {teamName ? (
        <CreateTaskDialog
          open={createTaskOpen}
          teamName={teamName}
          members={members}
          tasks={tasks}
          isTeamAlive={isAlive}
          onClose={() => setCreateTaskOpen(false)}
          onSubmit={handleCreateTask}
          submitting={creatingTask}
        />
      ) : null}

      {teamName && (
        <>
          <SendMessageDialog
            open={sendDialogOpen}
            teamName={teamName}
            members={members}
            defaultRecipient={sendDialogRecipient}
            isTeamAlive={isAlive}
            sending={sendingMessage}
            sendError={sendMessageError}
            lastResult={lastSendMessageResult}
            onSend={(member, text, summary, attachments, actionMode, taskRefs) => {
              void sendTeamMessage(teamName, {
                member,
                text,
                summary,
                attachments,
                actionMode,
                taskRefs,
              });
            }}
            onClose={() => {
              setSendDialogOpen(false);
              setSendDialogRecipient('');
            }}
          />

          <TaskDetailDialog
            open={selectedTask !== null}
            task={selectedTask}
            teamName={teamName}
            taskMap={taskMap}
            members={members}
            onClose={() => setSelectedTask(null)}
          />

          <MemberDetailDialog
            open={selectedMember !== null}
            member={selectedMember}
            teamName={teamName}
            members={members}
            tasks={tasks}
            messages={messages}
            isTeamAlive={isAlive}
            onClose={() => setSelectedMember(null)}
            onSendMessage={() => {
              if (selectedMember) {
                setSendDialogRecipient(selectedMember.name);
                setSelectedMember(null);
                setSendDialogOpen(true);
              }
            }}
            onAssignTask={() => {
              setSelectedMember(null);
              setCreateTaskOpen(true);
            }}
            onTaskClick={(task) => {
              setSelectedMember(null);
              setSelectedTask(task);
            }}
          />

          <LaunchTeamDialog
            mode="launch"
            open={launchDialogOpen}
            teamName={teamName}
            members={members}
            provisioningError={provisioningError}
            clearProvisioningError={clearProvisioningError}
            onClose={() => setLaunchDialogOpen(false)}
            onLaunch={async (request) => {
              await launchTeam(request);
              setLaunchDialogOpen(false);
            }}
          />

          <TrashDialog
            open={trashOpen}
            tasks={deletedTasks}
            onClose={() => setTrashOpen(false)}
            onRestore={(taskId) => {
              void (async () => {
                try {
                  await restoreTask(teamName, taskId);
                } catch {
                  // error via store
                }
              })();
            }}
          />
        </>
      )}

      <CreateTeamDialog
        open={createTeamOpen}
        canCreate={canCreate}
        provisioningErrorsByTeam={provisioningErrorByTeam}
        clearProvisioningError={clearProvisioningError}
        existingTeamNames={existingTeamNames}
        onClose={() => setCreateTeamOpen(false)}
        onCreate={async (request) => {
          await createTeam(request);
          setCreateTeamOpen(false);
        }}
        onOpenTeam={(name, projectPath) => {
          setCreateTeamOpen(false);
          openTeamTab(name, projectPath);
        }}
      />
    </>
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
  onCreateTask: () => void;
  onLaunchTeam: () => void;
  onNewTeam: () => void;
  onSendMessage: () => void;
  onTrash?: () => void;
}

const DashboardHeader = ({
  teamName,
  runningCount,
  totalCount,
  view,
  onViewChange,
  filter,
  onFilterChange,
  onCreateTask,
  onLaunchTeam,
  onNewTeam,
  onSendMessage,
  onTrash,
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
      <button
        type="button"
        onClick={onCreateTask}
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12px] font-medium text-white transition-transform duration-300 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-base)]"
        style={{
          background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
          boxShadow: '0 8px 22px -10px rgba(124, 92, 255, 0.5)',
        }}
      >
        <span aria-hidden="true">+</span>
        <span>New Task</span>
      </button>
      <button
        type="button"
        onClick={onLaunchTeam}
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12px] font-medium text-white transition-transform duration-300 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-base)]"
        style={{
          background: 'linear-gradient(135deg, var(--a-cyan) 0%, var(--a-violet) 100%)',
          boxShadow: '0 8px 22px -10px rgba(61, 198, 255, 0.4)',
        }}
      >
        <span>Launch Team</span>
      </button>
      <button
        type="button"
        onClick={onNewTeam}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--glass-shade)] bg-white/40 px-4 text-[12px] font-medium text-[color:var(--ink-1)] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
      >
        <span>New Team</span>
      </button>
      <button
        type="button"
        onClick={onSendMessage}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--glass-shade)] bg-white/40 px-4 text-[12px] font-medium text-[color:var(--ink-1)] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
      >
        <span>Send Message</span>
      </button>
      {onTrash && (
        <button
          type="button"
          onClick={onTrash}
          aria-label="View deleted tasks"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--glass-shade)] bg-white/40 text-[color:var(--ink-2)] transition-colors hover:bg-white/60 hover:text-[color:var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
            <path
              fillRule="evenodd"
              d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
            />
          </svg>
        </button>
      )}
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
