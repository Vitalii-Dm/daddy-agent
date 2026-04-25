/**
 * Shared request/response types for the team-data-worker thread.
 */

import type { MemberLogSummary, TeamData } from '@shared/types';

// ── Payloads ──

export interface GetTeamDataPayload {
  teamName: string;
}

export interface FindLogsForTaskPayload {
  teamName: string;
  taskId: string;
  options?: {
    owner?: string;
    status?: string;
    intervals?: { startedAt: string; completedAt?: string }[];
    since?: string;
  };
}

// ── Request / Response ──

export type TeamDataWorkerRequest =
  | { id: string; op: 'getTeamData'; payload: GetTeamDataPayload }
  | { id: string; op: 'findLogsForTask'; payload: FindLogsForTaskPayload };

export type TeamDataWorkerResponse =
  | { id: string; ok: true; result: TeamData | MemberLogSummary[] }
  | { id: string; ok: false; error: string };
