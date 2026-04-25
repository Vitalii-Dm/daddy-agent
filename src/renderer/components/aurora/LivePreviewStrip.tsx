import React from 'react';
import { motion } from 'motion/react';

import type { ResolvedTeamMember } from '@shared/types/team';

import { LiquidGlass } from './LiquidGlass';
import { Mascot, inferMascotRole, inferMascotStatus, type MascotRole } from './Mascot';
import { useAuroraTeam } from './hooks/useAuroraTeam';

interface PreviewTile {
  key: string;
  name: string;
  role: MascotRole;
  status: ReturnType<typeof inferMascotStatus>;
  task: string;
}

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

// Five-tile horizontal strip parallaxing along the bottom of the hero. Pulls
// from the live team via useAuroraTeam(). Shows an empty state when no team
// is loaded.
export const LivePreviewStrip = (): React.JSX.Element => {
  const { members } = useAuroraTeam();
  const tiles = members.slice(0, 5).map(memberToTile);

  if (members.length === 0) {
    return (
      <div className="flex w-full items-center justify-center py-4">
        <span className="rounded-full bg-white/65 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-2)] shadow-[0_4px_12px_-6px_rgba(20,19,26,0.18)]">
          No agents yet
        </span>
      </div>
    );
  }

  return (
    <div className="relative isolate w-full overflow-hidden">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12"
        aria-hidden="true"
        style={{ background: 'linear-gradient(to right, var(--bg-base), transparent)' }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12"
        aria-hidden="true"
        style={{ background: 'linear-gradient(to left, var(--bg-base), transparent)' }}
      />

      <div className="flex min-w-0 items-stretch gap-4 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tiles.map((tile, idx) => (
          <motion.div
            key={tile.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: APPLE_EASE, delay: idx * 0.06 }}
            className="shrink-0"
          >
            <PreviewTileCard tile={tile} />
          </motion.div>
        ))}
      </div>
    </div>
  );
};

const PreviewTileCard = ({ tile }: { tile: PreviewTile }): React.JSX.Element => {
  const dot =
    tile.status === 'coding' || tile.status === 'thinking'
      ? 'var(--ok)'
      : tile.status === 'blocked'
        ? 'var(--err)'
        : tile.status === 'waiting'
          ? 'var(--warn)'
          : 'var(--ink-4)';
  const isInactive = !tile.status || tile.status === 'idle';

  return (
    <LiquidGlass
      radius={22}
      shadow="soft"
      className={
        'flex h-[148px] w-[212px] flex-col justify-between p-4 transition-opacity duration-300' +
        (isInactive ? ' opacity-70' : '')
      }
    >
      <div className="flex items-center gap-3">
        <Mascot role={tile.role} size={48} seed={tile.key} status={tile.status} halo />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[color:var(--ink-1)]">{tile.name}</p>
          <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-3)]">
            {tile.role}
          </p>
        </div>
      </div>
      <div
        className="flex items-center gap-2 truncate rounded-xl border border-white/60 bg-white/45 px-2.5 py-1.5"
        style={{
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
        }}
      >
        <span
          className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: dot }}
          aria-hidden="true"
        />
        <span className="truncate text-[11.5px] text-[color:var(--ink-2)]">{tile.task}</span>
      </div>
    </LiquidGlass>
  );
};

function memberToTile(member: ResolvedTeamMember): PreviewTile {
  return {
    key: member.name,
    name: member.name,
    role: inferMascotRole(member.role ?? member.agentType ?? member.workflow),
    status: inferMascotStatus(member.status as unknown as string) ?? 'idle',
    task: member.currentTaskId ? `Task ${member.currentTaskId.slice(0, 8)}` : 'Awaiting task',
  };
}
