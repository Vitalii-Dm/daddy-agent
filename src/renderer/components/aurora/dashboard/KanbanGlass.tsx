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

type ColumnId = 'todo' | 'in_progress' | 'review' | 'done';

interface ColumnDef {
  id: ColumnId;
  title: string;
  hint: string;
  accent: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'todo', title: 'Backlog', hint: 'Queued', accent: 'var(--ink-3)' },
  { id: 'in_progress', title: 'In progress', hint: 'Active', accent: 'var(--a-violet)' },
  { id: 'review', title: 'Review', hint: 'Awaiting sign-off', accent: 'var(--a-cyan)' },
  { id: 'done', title: 'Done', hint: 'Shipped', accent: 'var(--ok)' },
];

interface KanbanGlassProps {
  filter: string;
  view: string;
}

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

const SEED_CARDS: Record<ColumnId, SeedCard[]> = {
  todo: [
    seed('Set up team kanban', 'lead', 'Aurora Lead'),
    seed('Wire dnd-kit drag handlers', 'coder', 'Atlas Coder'),
  ],
  in_progress: [seed('Reskin task cards as glass', 'designer', 'Lyra Designer')],
  review: [seed('Audit alignment at 1280/1440/1920', 'reviewer', 'Vega Reviewer')],
  done: [seed('Mount AuroraShell as default', 'lead', 'Aurora Lead')],
};

interface SeedCard {
  id: string;
  subject: string;
  role: string;
  owner: string;
}

function seed(subject: string, role: string, owner: string): SeedCard {
  return { id: `seed-${subject.toLowerCase().replace(/\W+/g, '-')}`, subject, role, owner };
}

interface CardItem {
  id: string;
  subject: string;
  role: string;
  owner: string;
  blockedBy?: string[];
  isSeed: boolean;
}

// Glass kanban: 4 columns, drag cards between them. When a real team is loaded
// the cards come from selectedTeamData.tasks; otherwise a seed deck shows the
// surface in its best light. The DnD updates a local override map — when wired
// to a real team this would persist via TeamSlice mutators, but at this stage
// we keep the optimistic local state so the surface is fully interactive in
// the demo flow.
export const KanbanGlass = ({ filter, view }: KanbanGlassProps): React.JSX.Element => {
  const { members } = useAuroraTeam();
  const realTasks = useStore((s) => s.selectedTeamData?.tasks ?? []);
  const [overrides, setOverrides] = useState<Record<string, ColumnId>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  // Reset overrides when the underlying task set changes — keeps the surface
  // honest if the team's kanban refreshes from disk.
  useEffect(() => {
    setOverrides({});
  }, [realTasks.length]);

  const grouped = useMemo<Record<ColumnId, CardItem[]>>(() => {
    const acc: Record<ColumnId, CardItem[]> = { todo: [], in_progress: [], review: [], done: [] };
    if (realTasks.length === 0) {
      for (const id of ['todo', 'in_progress', 'review', 'done'] as ColumnId[]) {
        for (const card of SEED_CARDS[id]) {
          const col = overrides[card.id] ?? id;
          acc[col].push({ ...card, isSeed: true });
        }
      }
      return filterCards(acc, filter);
    }
    for (const task of realTasks) {
      const baseCol = mapTaskToColumn(task);
      const col = overrides[task.id] ?? baseCol;
      acc[col].push({
        id: task.id,
        subject: task.subject || task.displayId || 'Untitled task',
        role: inferRoleFromOwner(task.owner, members),
        owner: task.owner ?? 'Unassigned',
        blockedBy: task.blockedBy,
        isSeed: false,
      });
    }
    return filterCards(acc, filter);
  }, [overrides, realTasks, members, filter]);

  if (view === 'List') return <ListView grouped={grouped} />;
  if (view === 'Graph') return <GraphView />;

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
        setOverrides((prev) => ({ ...prev, [String(e.active.id)]: target }));
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <LiquidGlass
        radius={26}
        className="relative flex w-full flex-col gap-4 overflow-hidden p-4 sm:p-5"
      >
        <div
          className="flex w-full snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]"
          style={{ scrollSnapType: 'x mandatory', overscrollBehavior: 'contain' }}
        >
          {COLUMNS.map((col) => (
            <Column key={col.id} def={col} cards={grouped[col.id]} activeId={activeId} />
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
}

const Column = ({ def, cards, activeId }: ColumnProps): React.JSX.Element => {
  const { isOver, setNodeRef } = useDroppable({ id: def.id });
  return (
    <div
      ref={setNodeRef}
      className="relative flex h-full w-[300px] shrink-0 snap-start flex-col rounded-[20px] border border-white/55 bg-white/35 p-3"
      style={{ scrollSnapAlign: 'start', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }}
    >
      <header className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: def.accent }}
            aria-hidden="true"
          />
          <h4 className="text-[12px] font-medium text-[color:var(--ink-1)]">{def.title}</h4>
          <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--ink-3)]">
            {cards.length}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
          {def.hint}
        </span>
      </header>

      <div
        className={
          'flex min-h-[140px] flex-col gap-2 rounded-[14px] p-1 transition-colors duration-200 ' +
          (isOver ? 'bg-white/55' : 'bg-transparent')
        }
        style={isOver ? { boxShadow: '0 0 0 1px rgba(124, 92, 255, 0.4)' } : undefined}
      >
        {cards.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center rounded-[12px] border border-dashed px-3 py-6 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]"
            style={{ borderColor: 'rgba(20, 19, 26, 0.18)' }}
          >
            Drop here
          </div>
        ) : (
          cards.map((card) => (
            <DraggableCard key={card.id} card={card} dimmed={activeId === card.id} />
          ))
        )}
      </div>
    </div>
  );
};

const DraggableCard = ({
  card,
  dimmed,
}: {
  card: CardItem;
  dimmed: boolean;
}): React.JSX.Element => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: card.id });
  const reduceMotion = useReducedMotion();
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: dimmed ? 0 : 1,
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
      <CardSurface card={card} />
    </motion.div>
  );
};

const CardSurface = ({ card }: { card: CardItem }): React.JSX.Element => {
  const role = inferMascotRole(card.role);
  return (
    <div
      className="bg-white/72 group relative flex flex-col gap-2 overflow-hidden rounded-[16px] border border-white/65 p-3 transition-shadow duration-300 hover:shadow-[0_18px_38px_-22px_rgba(20,19,26,0.32)]"
      style={{
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 8px 22px -16px rgba(20,19,26,0.18)',
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-2 left-0 w-[3px] rounded-full"
        style={{ background: `linear-gradient(to bottom, var(--a-violet), var(--a-cyan))` }}
      />
      <p className="line-clamp-2 pl-2 text-[13px] font-medium leading-snug text-[color:var(--ink-1)]">
        {card.subject}
      </p>
      <div className="flex items-center justify-between pl-2">
        <div className="flex min-w-0 items-center gap-2">
          <Mascot role={role} size={24} seed={card.owner} />
          <span className="truncate text-[11.5px] text-[color:var(--ink-2)]">{card.owner}</span>
        </div>
        {card.blockedBy && card.blockedBy.length > 0 && (
          <span
            className="inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium uppercase tracking-[0.08em]"
            style={{ background: 'rgba(255,90,90,0.16)', color: '#A4262C' }}
          >
            blocked
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

const ListView = ({ grouped }: { grouped: Record<ColumnId, CardItem[]> }): React.JSX.Element => {
  const all = Object.entries(grouped).flatMap(([col, cards]) => cards.map((c) => ({ ...c, col })));
  return (
    <LiquidGlass radius={26} className="p-4">
      <ul className="divide-y divide-[color:var(--glass-shade)]">
        {all.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-3">
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
        ))}
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
  return value === 'todo' || value === 'in_progress' || value === 'review' || value === 'done';
}

function mapTaskToColumn(task: TeamTaskWithKanban): ColumnId {
  if (task.kanbanColumn === 'review') return 'review';
  if (task.kanbanColumn === 'approved' || task.status === 'completed') return 'done';
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
  if (filter === 'All') return acc;
  if (filter === 'In progress') {
    return { todo: [], in_progress: acc.in_progress, review: [], done: [] };
  }
  if (filter === 'Review') {
    return { todo: [], in_progress: [], review: acc.review, done: [] };
  }
  if (filter === 'Blocked') {
    const out: Record<ColumnId, CardItem[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const col of Object.keys(acc) as ColumnId[]) {
      out[col] = acc[col].filter((c) => c.blockedBy && c.blockedBy.length > 0);
    }
    return out;
  }
  return acc;
}
