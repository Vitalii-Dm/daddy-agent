import React, { useEffect, useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { motion, useReducedMotion } from 'motion/react';

import type { ResolvedTeamMember, TeamTaskWithKanban } from '@shared/types/team';

import { useStore } from '@renderer/store';

import { LiquidGlass } from '../LiquidGlass';
import { Mascot, inferMascotRole } from '../Mascot';
import { useAuroraTeam } from '../hooks/useAuroraTeam';

type ColumnId = 'todo' | 'in_progress' | 'review' | 'blocked' | 'done';

interface ColumnDef {
  id: ColumnId;
  title: string;
  hint: string;
  accent: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'todo', title: 'Backlog', hint: 'Queued', accent: '#9CB8FF' },
  { id: 'in_progress', title: 'In progress', hint: 'Active', accent: 'var(--a-violet)' },
  { id: 'review', title: 'Review', hint: 'Awaiting sign-off', accent: 'var(--a-peach)' },
  { id: 'blocked', title: 'Blocked', hint: 'Waiting', accent: 'var(--err)' },
  { id: 'done', title: 'Done', hint: 'Shipped', accent: 'var(--ok)' },
];

interface KanbanGlassProps {
  filter: string;
  view: string;
  onTaskClick?: (task: TeamTaskWithKanban) => void;
  onCreateTask?: () => void;
}

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

interface CardItem {
  id: string;
  subject: string;
  role: string;
  owner: string;
  blockedBy?: string[];
}

// Glass kanban: 4 columns, drag cards between them. Cards come from
// selectedTeamData.tasks; when no team is loaded, columns show an empty state.
// The DnD updates a local override map — when wired to a real team this would
// persist via TeamSlice mutators, but at this stage we keep the optimistic
// local state so the surface is fully interactive in the demo flow.
export const KanbanGlass = ({
  filter,
  view,
  onTaskClick,
  onCreateTask,
}: KanbanGlassProps): React.JSX.Element => {
  const { members, teamName } = useAuroraTeam();
  const realTasks = useStore((s) => s.selectedTeamData?.tasks ?? []);
  const updateKanban = useStore((s) => s.updateKanban);
  const overridesStorageKey = teamName ? `aurora.kanban.overrides.${teamName}` : null;
  const [overrides, setOverrides] = useState<Record<string, ColumnId>>(() =>
    loadOverridesFromStorage(overridesStorageKey)
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    setOverrides(loadOverridesFromStorage(overridesStorageKey));
  }, [overridesStorageKey]);

  useEffect(() => {
    if (!overridesStorageKey) return;
    try {
      sessionStorage.setItem(overridesStorageKey, JSON.stringify(overrides));
    } catch {
      // sessionStorage may be unavailable in some Electron contexts; ignore.
    }
  }, [overrides, overridesStorageKey]);

  const grouped = useMemo<Record<ColumnId, CardItem[]>>(() => {
    const acc: Record<ColumnId, CardItem[]> = {
      todo: [],
      in_progress: [],
      review: [],
      blocked: [],
      done: [],
    };
    for (const task of realTasks) {
      const baseCol = mapTaskToColumn(task);
      const col = overrides[task.id] ?? baseCol;
      acc[col].push({
        id: task.id,
        subject: task.subject || task.displayId || 'Untitled task',
        role: inferRoleFromOwner(task.owner, members),
        owner: task.owner ?? 'Unassigned',
        blockedBy: task.blockedBy,
      });
    }
    return filterCards(acc, filter);
  }, [overrides, realTasks, members, filter]);

  if (view === 'List')
    return <ListView grouped={grouped} onTaskClick={onTaskClick} realTasks={realTasks} />;
  if (view === 'Graph') return <GraphView />;

  const isEmpty = realTasks.length === 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={(e: DragEndEvent) => {
        setActiveId(null);
        const overId = e.over?.id;
        if (!overId) return;
        const target = String(overId);
        if (!isColumnId(target)) return;
        const cardId = String(e.active.id);
        setOverrides((prev) => ({ ...prev, [cardId]: target }));
        if (teamName) {
          // Only 'review' and 'approved' (done) are supported by the patch API.
          // For todo/in_progress the optimistic local override is the best we can do.
          if (target === 'review') {
            void updateKanban(teamName, cardId, { op: 'set_column', column: 'review' });
          } else if (target === 'done') {
            void updateKanban(teamName, cardId, { op: 'set_column', column: 'approved' });
          }
          // TODO: persist via store when patch supports all columns (todo, in_progress)
        }
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <LiquidGlass
        radius={26}
        className="relative flex min-h-0 w-full flex-col gap-4 overflow-hidden p-4 sm:p-5"
        style={{ maxHeight: 'calc(100vh - 200px)' }}
      >
        {isEmpty && (
          <p className="px-1 pb-1 text-[12px] text-[color:var(--ink-3)]">
            No tasks yet. Create a task to get started.
          </p>
        )}
        <div
          className="flex min-h-0 w-full flex-1 gap-3 overflow-hidden pb-2"
          style={{ overscrollBehavior: 'contain' }}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.id}
              def={col}
              cards={grouped[col.id]}
              activeId={activeId}
              realTasks={realTasks}
              onTaskClick={onTaskClick}
              onCreateTask={onCreateTask}
            />
          ))}
        </div>
      </LiquidGlass>

      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {activeId ? <CardOverlay activeId={activeId} grouped={grouped} /> : null}
      </DragOverlay>
    </DndContext>
  );
};

interface ColumnProps {
  def: ColumnDef;
  cards: CardItem[];
  activeId: string | null;
  realTasks: TeamTaskWithKanban[];
  onTaskClick?: (task: TeamTaskWithKanban) => void;
  onCreateTask?: () => void;
}

const Column = ({
  def,
  cards,
  activeId,
  realTasks,
  onTaskClick,
  onCreateTask,
}: ColumnProps): React.JSX.Element => {
  const { isOver, setNodeRef } = useDroppable({ id: def.id });
  return (
    <div
      ref={setNodeRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-[20px] border border-white/55 bg-white/35 p-3"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }}
    >
      <header className="glass-inner sticky top-0 z-10 mb-3 flex flex-col gap-1 rounded-[12px] px-3 py-2">
        {/* Row 1: status dot + full column name. Name is on its own row
            so column-narrow widths (1280–1440 with 5 columns) don't
            truncate it to a single letter. */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex size-2 shrink-0 rounded-full"
            style={{ background: def.accent, boxShadow: `0 0 8px ${def.accent}` }}
            aria-hidden="true"
          />
          <h4 className="min-w-0 flex-1 text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[color:var(--ink-1)]">
            {def.title}
          </h4>
        </div>
        {/* Row 2: count + add button. Quiet count text (no pill) so the
            row stays light. */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tabular-nums text-[color:var(--ink-3)]">
            {cards.length} {cards.length === 1 ? 'task' : 'tasks'}
          </span>
          {onCreateTask && (
            <button
              type="button"
              onClick={onCreateTask}
              aria-label={`Add task to ${def.title}`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-white/65 text-[color:var(--ink-2)] transition-all duration-200 hover:scale-[1.06] hover:text-[color:var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
              style={{
                background: 'rgba(255,255,255,0.55)',
                backdropFilter: 'blur(18px) saturate(180%)',
                WebkitBackdropFilter: 'blur(18px) saturate(180%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.9), 0 4px 12px -6px rgba(20,19,26,0.18)',
              }}
            >
              <span aria-hidden="true" className="text-[12px] leading-none">
                +
              </span>
            </button>
          )}
        </div>
      </header>

      <div
        className={
          'glass-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[14px] p-1 transition-colors duration-200 ' +
          (isOver ? 'bg-white/55' : 'bg-transparent')
        }
        style={isOver ? { boxShadow: '0 0 0 1px rgba(124, 92, 255, 0.4)' } : undefined}
      >
        {cards.length === 0 && isOver ? (
          <div
            className="flex flex-1 items-center justify-center rounded-[12px] border border-dashed px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.14em]"
            style={{
              borderColor: 'rgba(124, 92, 255, 0.45)',
              color: 'var(--a-violet)',
            }}
          >
            Drop here
          </div>
        ) : cards.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center px-3 py-6 text-center text-[18px] text-[color:var(--ink-4)]"
            aria-hidden="true"
          >
            —
          </div>
        ) : (
          cards.map((card) => (
            <DraggableCard
              key={card.id}
              card={card}
              dimmed={activeId === card.id}
              realTasks={realTasks}
              onTaskClick={onTaskClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

const DraggableCard = ({
  card,
  dimmed,
  realTasks,
  onTaskClick,
}: {
  card: CardItem;
  dimmed: boolean;
  realTasks: TeamTaskWithKanban[];
  onTaskClick?: (task: TeamTaskWithKanban) => void;
}): React.JSX.Element => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: card.id });
  const reduceMotion = useReducedMotion();
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: dimmed ? 0 : 1,
  };

  const handleClick = (): void => {
    if (!onTaskClick) return;
    const realTask = realTasks.find((t) => t.id === card.id);
    if (realTask) onTaskClick(realTask);
  };

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout={!reduceMotion}
      transition={{ duration: 0.28, ease: APPLE_EASE }}
      {...attributes}
      {...listeners}
      className="cursor-grab touch-none active:cursor-grabbing"
    >
      <CardSurface card={card} onClick={onTaskClick ? handleClick : undefined} />
    </motion.div>
  );
};

const ROLE_GLOW: Record<ReturnType<typeof inferMascotRole>, string> = {
  lead: 'rgba(124, 92, 255, 0.55)',
  coder: 'rgba(61, 198, 255, 0.55)',
  reviewer: 'rgba(255, 156, 122, 0.55)',
  researcher: 'rgba(184, 242, 123, 0.55)',
  designer: 'rgba(159, 138, 255, 0.55)',
  ops: 'rgba(156, 163, 175, 0.45)',
};

const CardSurface = ({
  card,
  onClick,
}: {
  card: CardItem;
  onClick?: () => void;
}): React.JSX.Element => {
  const role = inferMascotRole(card.role);
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={
        'bg-white/72 group relative flex flex-col gap-2 rounded-[16px] border border-white/65 p-3 transition-shadow duration-300 hover:shadow-[0_18px_38px_-22px_rgba(20,19,26,0.32)]' +
        (onClick ? ' cursor-pointer' : '')
      }
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 8px 22px -16px rgba(20,19,26,0.18)',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-5 -z-10 rounded-[28px] opacity-0 blur-[28px] transition-opacity duration-300 group-hover:opacity-45"
        style={{
          background: `radial-gradient(closest-side, ${ROLE_GLOW[role]}, transparent 70%)`,
        }}
      />
      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-[color:var(--ink-1)]">
        {card.subject}
      </p>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Mascot role={role} size={24} seed={card.owner} />
          <span className="truncate text-[12px] text-[color:var(--ink-2)]">{card.owner}</span>
        </div>
        {card.blockedBy && card.blockedBy.length > 0 && (
          <span
            className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em]"
            style={{ background: 'rgba(255,90,90,0.12)', color: 'var(--err)' }}
          >
            BLOCKED
          </span>
        )}
      </div>
    </div>
  );
};

const CardOverlay = ({
  activeId,
  grouped,
}: {
  activeId: string;
  grouped: Record<ColumnId, CardItem[]>;
}): React.JSX.Element | null => {
  const card = Object.values(grouped)
    .flat()
    .find((c) => c.id === activeId);
  if (!card) return null;
  return (
    <div className="rotate-[1.5deg] scale-[1.02] drop-shadow-[0_22px_40px_rgba(20,19,26,0.28)]">
      <CardSurface card={card} />
    </div>
  );
};

const ListView = ({
  grouped,
  realTasks,
  onTaskClick,
}: {
  grouped: Record<ColumnId, CardItem[]>;
  realTasks: TeamTaskWithKanban[];
  onTaskClick?: (task: TeamTaskWithKanban) => void;
}): React.JSX.Element => {
  const all = Object.entries(grouped).flatMap(([col, cards]) => cards.map((c) => ({ ...c, col })));
  return (
    <LiquidGlass radius={26} className="p-4">
      <ul className="divide-y divide-[color:var(--glass-shade)]">
        {all.map((c) => {
          const realTask = realTasks.find((t) => t.id === c.id);
          const handleClick = realTask && onTaskClick ? () => onTaskClick(realTask) : undefined;
          return (
            <li
              key={c.id}
              onClick={handleClick}
              role={handleClick ? 'button' : undefined}
              tabIndex={handleClick ? 0 : undefined}
              onKeyDown={
                handleClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClick();
                      }
                    }
                  : undefined
              }
              className={
                'flex items-center justify-between gap-3 py-3' +
                (handleClick ? ' cursor-pointer rounded-lg px-2 hover:bg-white/40' : '')
              }
            >
              <div className="flex min-w-0 items-center gap-3">
                <Mascot role={inferMascotRole(c.role)} size={32} seed={c.owner} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[color:var(--ink-1)]">
                    {c.subject}
                  </p>
                  <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
                    {c.owner}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
                {c.col.replace('_', ' ')}
              </span>
            </li>
          );
        })}
        {all.length === 0 && (
          <li className="py-8 text-center text-[13px] text-[color:var(--ink-3)]">No tasks yet.</li>
        )}
      </ul>
    </LiquidGlass>
  );
};

const GraphView = (): React.JSX.Element => (
  <LiquidGlass radius={26} className="flex h-[420px] items-center justify-center p-5 text-center">
    <p className="max-w-[260px] font-serif italic text-[color:var(--ink-2)]">
      Graph view is reserved for the agent-graph integration. Coming soon.
    </p>
  </LiquidGlass>
);

function isColumnId(value: string): value is ColumnId {
  return (
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'review' ||
    value === 'blocked' ||
    value === 'done'
  );
}

function loadOverridesFromStorage(key: string | null): Record<string, ColumnId> {
  if (!key) return {};
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, ColumnId> = {};
    for (const [taskId, col] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof col === 'string' && isColumnId(col)) out[taskId] = col;
    }
    return out;
  } catch {
    return {};
  }
}

function mapTaskToColumn(task: TeamTaskWithKanban): ColumnId {
  if (task.kanbanColumn === 'approved' || task.status === 'completed') return 'done';
  if (task.kanbanColumn === 'review') return 'review';
  if (task.blockedBy && task.blockedBy.length > 0) return 'blocked';
  if (task.status === 'in_progress') return 'in_progress';
  return 'todo';
}

function inferRoleFromOwner(owner: string | undefined, members: ResolvedTeamMember[]): string {
  if (!owner) return 'coder';
  const match = members.find((m) => m.name === owner);
  return match?.role ?? match?.agentType ?? 'coder';
}

function filterCards(
  acc: Record<ColumnId, CardItem[]>,
  filter: string
): Record<ColumnId, CardItem[]> {
  const empty = (): Record<ColumnId, CardItem[]> => ({
    todo: [],
    in_progress: [],
    review: [],
    blocked: [],
    done: [],
  });
  if (filter === 'All') return acc;
  if (filter === 'In progress') {
    return { ...empty(), in_progress: acc.in_progress };
  }
  if (filter === 'Review') {
    return { ...empty(), review: acc.review };
  }
  if (filter === 'Blocked') {
    return { ...empty(), blocked: acc.blocked };
  }
  return acc;
}
