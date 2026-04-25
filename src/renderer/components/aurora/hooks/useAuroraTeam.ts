import { useMemo } from 'react';

import { useStore } from '@renderer/store';
import type { ResolvedTeamMember } from '@shared/types/team';

export interface AuroraTeamSummary {
  teamName: string | null;
  members: ResolvedTeamMember[];
  runningCount: number;
  totalCount: number;
  isAlive: boolean;
}

const EMPTY_MEMBERS: ResolvedTeamMember[] = [];

const RUNNING_STATUSES = new Set(['running', 'thinking', 'coding', 'busy', 'active']);

// Returns the currently-selected team in a shape the Aurora shell can read at a glance.
// Falls back to the first cached team so the shell still has something to show before
// the user has explicitly opened a team tab.
export function useAuroraTeam(): AuroraTeamSummary {
  const selectedTeamData = useStore((s) => s.selectedTeamData);
  const teamDataCacheByName = useStore((s) => s.teamDataCacheByName);

  return useMemo(() => {
    const cached = selectedTeamData ?? Object.values(teamDataCacheByName)[0] ?? null;
    if (!cached) {
      return {
        teamName: null,
        members: EMPTY_MEMBERS,
        runningCount: 0,
        totalCount: 0,
        isAlive: false,
      };
    }

    const members = cached.members ?? EMPTY_MEMBERS;
    const runningCount = members.reduce((acc, m) => {
      const status = (m.status ?? '').toLowerCase();
      return acc + (RUNNING_STATUSES.has(status) ? 1 : 0);
    }, 0);

    return {
      teamName: cached.config?.name ?? null,
      members,
      runningCount,
      totalCount: members.length,
      isAlive: Boolean(cached.isAlive),
    };
  }, [selectedTeamData, teamDataCacheByName]);
}
