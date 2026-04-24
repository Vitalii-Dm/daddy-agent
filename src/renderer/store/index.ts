import { api } from '@renderer/api';
import { normalizePath } from '@renderer/utils/pathNormalize';
import { createLogger } from '@shared/utils/logger';
import { create } from 'zustand';

import { createConfigSlice } from './slices/configSlice';
import { createConnectionSlice } from './slices/connectionSlice';
import { createContextSlice } from './slices/contextSlice';
import { createConversationSlice } from './slices/conversationSlice';
import { createPaneSlice } from './slices/paneSlice';
import { createProjectSlice } from './slices/projectSlice';
import { createRepositorySlice } from './slices/repositorySlice';
import { createSessionDetailSlice } from './slices/sessionDetailSlice';
import { createSessionSlice } from './slices/sessionSlice';
import { createSubagentSlice } from './slices/subagentSlice';
import { createTabSlice } from './slices/tabSlice';
import { createTabUISlice } from './slices/tabUISlice';
import {
  createTeamSlice,
  evictStaleTeamSliceEntries,
  getLastResolvedTeamDataRefreshAt,
  isTeamDataRefreshPending,
  selectTeamDataForName,
} from './slices/teamSlice';
import { createUISlice } from './slices/uiSlice';

import type { AppState } from './types';
import type {
  ActiveToolCall,
  LeadContextUsage,
  TeamChangeEvent,
  ToolActivityEventPayload,
  ToolApprovalEvent,
  ToolApprovalRequest,
} from '@shared/types';

const FINISHED_TOOL_DISPLAY_MS = 1_500;
const MAX_TOOL_HISTORY_PER_MEMBER = 6;
const TEAM_CHANGE_EVENT_BURST_WINDOW_MS = 4_000;
const TEAM_CHANGE_EVENT_BURST_WARN_COUNT = 8;
const TEAM_CHANGE_EVENT_WARN_THROTTLE_MS = 2_000;
const TEAM_VISIBLE_IDLE_WATCHDOG_POLL_MS = 10_000;
const TEAM_VISIBLE_IDLE_WATCHDOG_STALE_MS = 30_000;
const logger = createLogger('Store:index');
const RELEVANT_TEAM_CHANGE_EVENT_TYPES = new Set<TeamChangeEvent['type']>([
  'task',
  'config',
  'inbox',
  'lead-message',
  'lead-context',
  'lead-activity',
  'process',
  'member-spawn',
]);
const teamChangeEventDiagnostics = new Map<
  string,
  {
    windowStartedAt: number;
    count: number;
    lastWarnAt: number;
    countsByType: Record<string, number>;
  }
>();

function noteTeamChangeEventBurst(teamName: string, eventType: string, visible: boolean): void {
  if (!visible) return;

  if (teamChangeEventDiagnostics.size > 20) {
    const now = Date.now();
    for (const [key, diag] of teamChangeEventDiagnostics) {
      if (now - diag.windowStartedAt > 60_000) teamChangeEventDiagnostics.delete(key);
    }
  }

  const now = Date.now();
  const diagnostic = teamChangeEventDiagnostics.get(teamName) ?? {
    windowStartedAt: now,
    count: 0,
    lastWarnAt: 0,
    countsByType: {},
  };

  if (now - diagnostic.windowStartedAt > TEAM_CHANGE_EVENT_BURST_WINDOW_MS) {
    diagnostic.windowStartedAt = now;
    diagnostic.count = 0;
    diagnostic.countsByType = {};
  }

  diagnostic.count += 1;
  diagnostic.countsByType[eventType] = (diagnostic.countsByType[eventType] ?? 0) + 1;

  if (
    diagnostic.count >= TEAM_CHANGE_EVENT_BURST_WARN_COUNT &&
    now - diagnostic.lastWarnAt >= TEAM_CHANGE_EVENT_WARN_THROTTLE_MS
  ) {
    diagnostic.lastWarnAt = now;
    const typeSummary = Object.entries(diagnostic.countsByType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}`)
      .join(',');
    logger.warn(
      `[perf] team-change burst team=${teamName} total=${diagnostic.count} windowMs=${
        now - diagnostic.windowStartedAt
      } types=${typeSummary}`
    );
  }

  teamChangeEventDiagnostics.set(teamName, diagnostic);
}

export const useStore = create<AppState>()((...args) => ({
  ...createProjectSlice(...args),
  ...createRepositorySlice(...args),
  ...createSessionSlice(...args),
  ...createSessionDetailSlice(...args),
  ...createSubagentSlice(...args),
  ...createTeamSlice(...args),
  ...createConversationSlice(...args),
  ...createTabSlice(...args),
  ...createTabUISlice(...args),
  ...createPaneSlice(...args),
  ...createUISlice(...args),
  ...createConfigSlice(...args),
  ...createConnectionSlice(...args),
  ...createContextSlice(...args),
}));

export function initializeNotificationListeners(): () => void {
  const cleanupFns: (() => void)[] = [];
  useStore.getState().subscribeProvisioningProgress();
  cleanupFns.push(() => {
    useStore.getState().unsubscribeProvisioningProgress();
  });

  void (async () => {
    await useStore.getState().fetchConfig();
    await Promise.all([
      useStore.getState().fetchRepositoryGroups(),
      useStore.getState().fetchAllTasks(),
      useStore.getState().fetchTeams(),
    ]);
  })();

  const pendingSessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingProjectRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const teamLastRelevantActivityAt = new Map<string, number>();
  const teamLastIdleWatchdogRefreshAt = new Map<string, number>();
  let teamRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let teamPresenceRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let memberSpawnRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let toolActivityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  let teamListRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let globalTasksRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const SESSION_REFRESH_DEBOUNCE_MS = 150;
  const PROJECT_REFRESH_DEBOUNCE_MS = 300;
  const TEAM_REFRESH_THROTTLE_MS = 800;
  const TEAM_PRESENCE_REFRESH_THROTTLE_MS = 400;
  const TEAM_MEMBER_SPAWN_REFRESH_THROTTLE_MS = 500;
  const TEAM_LIST_REFRESH_THROTTLE_MS = 2000;
  const GLOBAL_TASKS_REFRESH_THROTTLE_MS = 500;

  const scheduleMemberSpawnStatusesRefresh = (teamName: string | null | undefined): void => {
    if (!teamName || !isTeamVisibleInAnyPane(teamName)) return;
    if (memberSpawnRefreshTimers.has(teamName)) return;
    const timer = setTimeout(() => {
      memberSpawnRefreshTimers.delete(teamName);
      void useStore.getState().fetchMemberSpawnStatuses(teamName);
    }, TEAM_MEMBER_SPAWN_REFRESH_THROTTLE_MS);
    memberSpawnRefreshTimers.set(teamName, timer);
  };

  const buildToolActivityTimerKey = (
    teamName: string,
    memberName: string,
    toolUseId: string,
    kind: 'fade'
  ): string => `${teamName}:${memberName}:${toolUseId}:${kind}`;

  const clearToolActivityTimer = (
    teamName: string,
    memberName: string,
    toolUseId: string,
    kind: 'fade'
  ): void => {
    const key = buildToolActivityTimerKey(teamName, memberName, toolUseId, kind);
    const existing = toolActivityTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      toolActivityTimers.delete(key);
    }
  };

  const scheduleToolActivityTimer = (
    teamName: string,
    memberName: string,
    toolUseId: string,
    kind: 'fade',
    delayMs: number,
    cb: () => void
  ): void => {
    clearToolActivityTimer(teamName, memberName, toolUseId, kind);
    const key = buildToolActivityTimerKey(teamName, memberName, toolUseId, kind);
    const timer = setTimeout(() => {
      toolActivityTimers.delete(key);
      cb();
    }, delayMs);
    toolActivityTimers.set(key, timer);
  };

  const clearToolActivityTimersForTeam = (teamName: string): void => {
    for (const [key, timer] of toolActivityTimers.entries()) {
      if (!key.startsWith(`${teamName}:`)) continue;
      clearTimeout(timer);
      toolActivityTimers.delete(key);
    }
  };

  const clearRuntimeToolStateForTeam = (
    prev: AppState,
    teamName: string
  ): Pick<AppState, 'activeToolsByTeam' | 'finishedVisibleByTeam' | 'toolHistoryByTeam'> => {
    const nextActive = { ...prev.activeToolsByTeam };
    const nextFinished = { ...prev.finishedVisibleByTeam };
    const nextHistory = { ...prev.toolHistoryByTeam };
    delete nextActive[teamName];
    delete nextFinished[teamName];
    delete nextHistory[teamName];
    return {
      activeToolsByTeam: nextActive,
      finishedVisibleByTeam: nextFinished,
      toolHistoryByTeam: nextHistory,
    };
  };

  const pushToolHistoryEntry = (
    history: Record<string, Record<string, ActiveToolCall[]>>,
    teamName: string,
    entry: ActiveToolCall
  ): Record<string, Record<string, ActiveToolCall[]>> => {
    const teamHistory = { ...(history[teamName] ?? {}) };
    const existing = teamHistory[entry.memberName] ?? [];
    teamHistory[entry.memberName] = [
      entry,
      ...existing.filter((t) => t.toolUseId !== entry.toolUseId),
    ].slice(0, MAX_TOOL_HISTORY_PER_MEMBER);
    return { ...history, [teamName]: teamHistory };
  };

  const upsertMemberToolEntry = (
    teamState: Record<string, Record<string, ActiveToolCall>> | undefined,
    entry: ActiveToolCall
  ): Record<string, Record<string, ActiveToolCall>> => ({
    ...(teamState ?? {}),
    [entry.memberName]: {
      ...((teamState ?? {})[entry.memberName] ?? {}),
      [entry.toolUseId]: entry,
    },
  });

  const removeMemberToolEntry = (
    teamState: Record<string, Record<string, ActiveToolCall>> | undefined,
    memberName: string,
    toolUseId: string
  ): Record<string, Record<string, ActiveToolCall>> => {
    if (!teamState?.[memberName]?.[toolUseId]) return teamState ?? {};
    const nextTeamState = { ...(teamState ?? {}) };
    const nextMemberState = { ...(nextTeamState[memberName] ?? {}) };
    delete nextMemberState[toolUseId];
    if (Object.keys(nextMemberState).length === 0) {
      delete nextTeamState[memberName];
    } else {
      nextTeamState[memberName] = nextMemberState;
    }
    return nextTeamState;
  };

  const removeMemberToolGroup = (
    teamState: Record<string, Record<string, ActiveToolCall>> | undefined,
    memberName: string
  ): Record<string, Record<string, ActiveToolCall>> => {
    if (!teamState?.[memberName]) return teamState ?? {};
    const nextTeamState = { ...(teamState ?? {}) };
    delete nextTeamState[memberName];
    return nextTeamState;
  };

  const removeMemberToolEntries = (
    teamState: Record<string, Record<string, ActiveToolCall>> | undefined,
    memberName: string,
    toolUseIds: readonly string[]
  ): Record<string, Record<string, ActiveToolCall>> => {
    if (!teamState?.[memberName] || toolUseIds.length === 0) return teamState ?? {};
    let nextTeamState = teamState ?? {};
    let changed = false;
    for (const toolUseId of toolUseIds) {
      if (!nextTeamState[memberName]?.[toolUseId]) continue;
      nextTeamState = removeMemberToolEntry(nextTeamState, memberName, toolUseId);
      changed = true;
    }
    return changed ? nextTeamState : (teamState ?? {});
  };

  const getBaseProjectId = (projectId: string | null | undefined): string | null => {
    if (!projectId) return null;
    const separatorIndex = projectId.indexOf('::');
    return separatorIndex >= 0 ? projectId.slice(0, separatorIndex) : projectId;
  };

  const getVisibleTeamNamesInAnyPane = (state = useStore.getState()): Set<string> => {
    const { paneLayout } = state;
    const visibleTeamNames = new Set<string>();
    for (const pane of paneLayout.panes) {
      if (!pane.activeTabId) continue;
      const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
      if (
        (activeTab?.type === 'team' || activeTab?.type === 'graph') &&
        activeTab.teamName != null
      ) {
        visibleTeamNames.add(activeTab.teamName);
      }
    }
    return visibleTeamNames;
  };

  const isTeamVisibleInAnyPane = (teamName: string): boolean => {
    return getVisibleTeamNamesInAnyPane().has(teamName);
  };

  const noteRelevantTeamActivity = (teamName: string, timestamp = Date.now()): void => {
    teamLastRelevantActivityAt.set(teamName, timestamp);
  };

  const getFocusedVisibleTeamName = (): string | null => {
    const state = useStore.getState();
    const focusedPane = state.paneLayout.panes.find(
      (pane) => pane.id === state.paneLayout.focusedPaneId
    );
    if (!focusedPane?.activeTabId) return null;
    const activeTab = focusedPane.tabs.find((tab) => tab.id === focusedPane.activeTabId);
    if ((activeTab?.type !== 'team' && activeTab?.type !== 'graph') || !activeTab.teamName)
      return null;
    if (!selectTeamDataForName(state, activeTab.teamName)) return null;
    return activeTab.teamName;
  };

  const pollFocusedVisibleTeamIdleWatchdog = async (): Promise<void> => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const current = useStore.getState();
    const teamName = getFocusedVisibleTeamName();
    if (!teamName || !isTeamVisibleInAnyPane(teamName)) return;
    if (current.selectedTeamName === teamName && current.selectedTeamLoading) return;
    if (isTeamDataRefreshPending(teamName)) return;
    const lastRelevantActivityAt = teamLastRelevantActivityAt.get(teamName) ?? 0;
    const lastResolvedRefreshAt = getLastResolvedTeamDataRefreshAt(teamName) ?? 0;
    const idleBaselineAt = Math.max(lastRelevantActivityAt, lastResolvedRefreshAt);
    if (idleBaselineAt === 0) return;
    const now = Date.now();
    if (now - idleBaselineAt < TEAM_VISIBLE_IDLE_WATCHDOG_STALE_MS) return;
    const lastWatchdogRefreshAt = teamLastIdleWatchdogRefreshAt.get(teamName) ?? 0;
    if (lastWatchdogRefreshAt >= idleBaselineAt) return;
    logger.warn(`[perf] idle-watchdog refresh team=${teamName} idleMs=${now - idleBaselineAt}`);
    try {
      await current.refreshTeamData(teamName, { withDedup: true });
    } finally {
      teamLastIdleWatchdogRefreshAt.set(
        teamName,
        Math.max(getLastResolvedTeamDataRefreshAt(teamName) ?? 0, idleBaselineAt, Date.now())
      );
    }
  };

  const scheduleSessionRefresh = (projectId: string, sessionId: string): void => {
    const key = `${projectId}/${sessionId}`;
    if (pendingSessionRefreshTimers.has(key)) return;
    const timer = setTimeout(() => {
      pendingSessionRefreshTimers.delete(key);
      void useStore.getState().refreshSessionInPlace(projectId, sessionId);
    }, SESSION_REFRESH_DEBOUNCE_MS);
    pendingSessionRefreshTimers.set(key, timer);
  };

  const scheduleProjectRefresh = (projectId: string): void => {
    const existingTimer = pendingProjectRefreshTimers.get(projectId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      pendingProjectRefreshTimers.delete(projectId);
      void useStore.getState().refreshSessionsInPlace(projectId);
    }, PROJECT_REFRESH_DEBOUNCE_MS);
    pendingProjectRefreshTimers.set(projectId, timer);
  };

  if (api.onTodoChange) {
    const cleanup = api.onTodoChange((event) => {
      if (!event.sessionId || event.type === 'unlink') return;
      const state = useStore.getState();
      if (state.selectedSessionId === event.sessionId && state.selectedProjectId) {
        scheduleSessionRefresh(state.selectedProjectId, event.sessionId);
      }
    });
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);
  }

  if (api.onFileChange) {
    const cleanup = api.onFileChange((event) => {
      if (event.type === 'unlink') return;
      const state = useStore.getState();
      const selectedProjectId = state.selectedProjectId;
      if (!selectedProjectId) return;
      const selectedProjectBaseId = getBaseProjectId(selectedProjectId);
      const eventProjectBaseId = getBaseProjectId(event.projectId);
      const matchesSelectedProject =
        eventProjectBaseId == null || selectedProjectBaseId === eventProjectBaseId;
      if (!matchesSelectedProject) return;
      const isTopLevelSessionEvent = !event.isSubagent;
      const isUnknownSession =
        event.sessionId == null ||
        !state.sessions.some((session) => session.id === event.sessionId);
      if (
        isTopLevelSessionEvent &&
        isUnknownSession &&
        (event.type === 'add' || (state.connectionMode === 'local' && event.type === 'change'))
      ) {
        scheduleProjectRefresh(selectedProjectId);
      }
      if (
        (event.type === 'change' || event.type === 'add') &&
        event.sessionId &&
        state.selectedSessionId === event.sessionId
      ) {
        scheduleSessionRefresh(selectedProjectId, event.sessionId);
      }
    });
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);
  }

  const teamIdleWatchdogTimer = setInterval(() => {
    void pollFocusedVisibleTeamIdleWatchdog();
    if (teamLastRelevantActivityAt.size > 20) {
      const cutoff = Date.now() - 3_600_000;
      for (const [key, ts] of teamLastRelevantActivityAt) {
        if (ts < cutoff) {
          teamLastRelevantActivityAt.delete(key);
          teamLastIdleWatchdogRefreshAt.delete(key);
        }
      }
    }
    const activeTeams = new Set((useStore.getState().teams ?? []).map((t) => t.teamName));
    if (activeTeams.size > 0) evictStaleTeamSliceEntries(activeTeams);
  }, TEAM_VISIBLE_IDLE_WATCHDOG_POLL_MS);
  cleanupFns.push(() => clearInterval(teamIdleWatchdogTimer));

  if (api.teams?.onTeamChange) {
    const cleanup = api.teams.onTeamChange((_event: unknown, event: TeamChangeEvent) => {
      const visibleTeam = Boolean(event.teamName) && isTeamVisibleInAnyPane(event.teamName);
      noteTeamChangeEventBurst(event.teamName, event.type, visibleTeam);

      const isIgnoredRuntimeRun = (() => {
        if (!event.runId) return false;
        const state = useStore.getState();
        return (
          state.ignoredProvisioningRunIds[event.runId] === event.teamName ||
          state.ignoredRuntimeRunIds[event.runId] === event.teamName
        );
      })();
      if (isIgnoredRuntimeRun) return;

      const isStaleRuntimeEvent = (() => {
        if (!event.runId) return false;
        const currentRunId = useStore.getState().currentRuntimeRunIdByTeam[event.teamName];
        return currentRunId != null && currentRunId !== event.runId;
      })();

      const seedCurrentRunIdIfMissing = (): void => {
        if (!event.runId) return;
        const currentRunId = useStore.getState().currentRuntimeRunIdByTeam[event.teamName];
        if (currentRunId == null) {
          useStore.setState((prev) => ({
            currentRuntimeRunIdByTeam: {
              ...prev.currentRuntimeRunIdByTeam,
              [event.teamName]: event.runId ?? null,
            },
            ignoredRuntimeRunIds: Object.fromEntries(
              Object.entries(prev.ignoredRuntimeRunIds).filter(([, tn]) => tn !== event.teamName)
            ),
          }));
        }
      };

      if (RELEVANT_TEAM_CHANGE_EVENT_TYPES.has(event.type) && !isStaleRuntimeEvent) {
        noteRelevantTeamActivity(event.teamName);
      }

      if (event.type === 'lead-activity' && event.detail) {
        if (isStaleRuntimeEvent) return;
        seedCurrentRunIdIfMissing();
        const nextActivity = event.detail as 'active' | 'idle' | 'offline';
        useStore.setState((prev) => {
          const nextState: Partial<typeof prev> = {
            leadActivityByTeam: {
              ...prev.leadActivityByTeam,
              [event.teamName]: nextActivity,
            },
          };
          const cachedTeamData = prev.teamDataCacheByName[event.teamName];
          if (cachedTeamData) {
            nextState.teamDataCacheByName = {
              ...prev.teamDataCacheByName,
              [event.teamName]: { ...cachedTeamData, isAlive: nextActivity !== 'offline' },
            };
          }
          if (prev.selectedTeamName === event.teamName && prev.selectedTeamData) {
            nextState.selectedTeamData = {
              ...prev.selectedTeamData,
              isAlive: nextActivity !== 'offline',
            };
          }
          if (nextActivity === 'offline') {
            nextState.leadContextByTeam = { ...prev.leadContextByTeam };
            delete nextState.leadContextByTeam[event.teamName];
            Object.assign(nextState, clearRuntimeToolStateForTeam(prev, event.teamName));
            nextState.currentRuntimeRunIdByTeam = { ...prev.currentRuntimeRunIdByTeam };
            delete nextState.currentRuntimeRunIdByTeam[event.teamName];
            nextState.ignoredRuntimeRunIds = event.runId
              ? { ...prev.ignoredRuntimeRunIds, [event.runId]: event.teamName }
              : prev.ignoredRuntimeRunIds;
            clearToolActivityTimersForTeam(event.teamName);
          }
          return nextState as typeof prev;
        });
        return;
      }

      if (event.type === 'lead-context' && event.detail) {
        if (isStaleRuntimeEvent) return;
        seedCurrentRunIdIfMissing();
        try {
          const ctx = JSON.parse(event.detail) as LeadContextUsage;
          useStore.setState((prev) => ({
            ...prev,
            leadContextByTeam: { ...prev.leadContextByTeam, [event.teamName]: ctx },
          }));
        } catch {
          /* ignore */
        }
        return;
      }

      if (event.type === 'tool-activity' && event.detail) {
        if (isStaleRuntimeEvent) return;
        seedCurrentRunIdIfMissing();
        try {
          const payload = JSON.parse(event.detail) as ToolActivityEventPayload;
          if (payload.action === 'start' && payload.activity) {
            const activity: ActiveToolCall = {
              memberName: payload.activity.memberName,
              toolUseId: payload.activity.toolUseId,
              toolName: payload.activity.toolName,
              preview: payload.activity.preview,
              startedAt: payload.activity.startedAt,
              source: payload.activity.source,
              state: 'running',
            };
            useStore.setState((prev) => ({
              activeToolsByTeam: {
                ...prev.activeToolsByTeam,
                [event.teamName]: upsertMemberToolEntry(
                  prev.activeToolsByTeam[event.teamName],
                  activity
                ),
              },
            }));
          } else if (payload.action === 'finish' && payload.memberName && payload.toolUseId) {
            const memberName = payload.memberName;
            const toolUseId = payload.toolUseId;
            useStore.setState((prev) => {
              const current = prev.activeToolsByTeam[event.teamName]?.[memberName]?.[toolUseId];
              if (!current) return {};
              const completed: ActiveToolCall = {
                ...current,
                state: payload.isError ? 'error' : 'complete',
                finishedAt: payload.finishedAt ?? new Date().toISOString(),
                resultPreview: payload.resultPreview,
              };
              scheduleToolActivityTimer(
                event.teamName,
                memberName,
                toolUseId,
                'fade',
                FINISHED_TOOL_DISPLAY_MS,
                () => {
                  useStore.setState((state) => {
                    const nextCurrent =
                      state.finishedVisibleByTeam[event.teamName]?.[memberName]?.[toolUseId];
                    if (!nextCurrent) return {};
                    return {
                      finishedVisibleByTeam: {
                        ...state.finishedVisibleByTeam,
                        [event.teamName]: removeMemberToolEntry(
                          state.finishedVisibleByTeam[event.teamName],
                          memberName,
                          toolUseId
                        ),
                      },
                    };
                  });
                }
              );
              return {
                activeToolsByTeam: {
                  ...prev.activeToolsByTeam,
                  [event.teamName]: removeMemberToolEntry(
                    prev.activeToolsByTeam[event.teamName],
                    memberName,
                    toolUseId
                  ),
                },
                finishedVisibleByTeam: {
                  ...prev.finishedVisibleByTeam,
                  [event.teamName]: upsertMemberToolEntry(
                    prev.finishedVisibleByTeam[event.teamName],
                    completed
                  ),
                },
                toolHistoryByTeam: pushToolHistoryEntry(
                  prev.toolHistoryByTeam,
                  event.teamName,
                  completed
                ),
              };
            });
          } else if (payload.action === 'reset') {
            if (payload.memberName) {
              const memberName = payload.memberName;
              const toolUseIds =
                Array.isArray(payload.toolUseIds) && payload.toolUseIds.length > 0
                  ? payload.toolUseIds
                  : null;
              useStore.setState((prev) => {
                if (!prev.activeToolsByTeam[event.teamName]?.[memberName]) return {};
                return {
                  activeToolsByTeam: {
                    ...prev.activeToolsByTeam,
                    [event.teamName]: toolUseIds
                      ? removeMemberToolEntries(
                          prev.activeToolsByTeam[event.teamName],
                          memberName,
                          toolUseIds
                        )
                      : removeMemberToolGroup(prev.activeToolsByTeam[event.teamName], memberName),
                  },
                };
              });
            } else {
              useStore.setState((prev) => ({
                activeToolsByTeam: { ...prev.activeToolsByTeam, [event.teamName]: {} },
              }));
            }
          }
        } catch {
          /* ignore */
        }
        return;
      }

      if (event.type === 'member-spawn') {
        if (isStaleRuntimeEvent) return;
        seedCurrentRunIdIfMissing();
        scheduleMemberSpawnStatusesRefresh(event.teamName);
        return;
      }

      if (event.type === 'inbox' || event.type === 'config' || event.type === 'process') {
        scheduleMemberSpawnStatusesRefresh(event.teamName);
      }

      if (event.type === 'lead-message') {
        if (isStaleRuntimeEvent) return;
        seedCurrentRunIdIfMissing();
        if (!event?.teamName || !isTeamVisibleInAnyPane(event.teamName)) return;
        if (teamRefreshTimers.has(event.teamName)) return;
        const timer = setTimeout(() => {
          teamRefreshTimers.delete(event.teamName);
          void useStore.getState().refreshTeamData(event.teamName, { withDedup: true });
        }, TEAM_REFRESH_THROTTLE_MS);
        teamRefreshTimers.set(event.teamName, timer);
        return;
      }

      if (event.type === 'log-source-change') {
        if (!event?.teamName || !isTeamVisibleInAnyPane(event.teamName)) return;
        if (teamPresenceRefreshTimers.has(event.teamName)) return;
        const timer = setTimeout(() => {
          teamPresenceRefreshTimers.delete(event.teamName);
          void useStore.getState().refreshTeamChangePresence(event.teamName);
        }, TEAM_PRESENCE_REFRESH_THROTTLE_MS);
        teamPresenceRefreshTimers.set(event.teamName, timer);
        return;
      }

      if (!teamListRefreshTimer) {
        teamListRefreshTimer = setTimeout(() => {
          teamListRefreshTimer = null;
          void useStore.getState().fetchTeams();
        }, TEAM_LIST_REFRESH_THROTTLE_MS);
      }

      const shouldRefreshGlobalTasks = event.type === 'task' || event.type === 'config';
      if (shouldRefreshGlobalTasks && !globalTasksRefreshTimer) {
        globalTasksRefreshTimer = setTimeout(() => {
          globalTasksRefreshTimer = null;
          void useStore.getState().fetchAllTasks();
        }, GLOBAL_TASKS_REFRESH_THROTTLE_MS);
      }

      if (!event?.teamName || !isTeamVisibleInAnyPane(event.teamName)) return;
      if (teamRefreshTimers.has(event.teamName)) return;
      const timer = setTimeout(() => {
        teamRefreshTimers.delete(event.teamName);
        void useStore.getState().refreshTeamData(event.teamName, { withDedup: true });
      }, TEAM_REFRESH_THROTTLE_MS);
      teamRefreshTimers.set(event.teamName, timer);
    });

    if (typeof cleanup === 'function') {
      cleanupFns.push(() => {
        cleanup();
        for (const t of teamRefreshTimers.values()) clearTimeout(t);
        teamRefreshTimers = new Map();
        for (const t of teamPresenceRefreshTimers.values()) clearTimeout(t);
        teamPresenceRefreshTimers = new Map();
        for (const t of memberSpawnRefreshTimers.values()) clearTimeout(t);
        memberSpawnRefreshTimers = new Map();
        for (const t of toolActivityTimers.values()) clearTimeout(t);
        toolActivityTimers = new Map();
        teamLastRelevantActivityAt.clear();
        teamLastIdleWatchdogRefreshAt.clear();
        if (teamListRefreshTimer) {
          clearTimeout(teamListRefreshTimer);
          teamListRefreshTimer = null;
        }
        if (globalTasksRefreshTimer) {
          clearTimeout(globalTasksRefreshTimer);
          globalTasksRefreshTimer = null;
        }
      });
    }
  }

  if (api.teams?.onProjectBranchChange) {
    const cleanup = api.teams.onProjectBranchChange((_event: unknown, event) => {
      if (!event?.projectPath) return;
      const normalizedPath = normalizePath(event.projectPath);
      if (!normalizedPath) return;
      useStore.setState((prev) => {
        const current = prev.branchByPath[normalizedPath];
        if (current === event.branch) return {};
        return { branchByPath: { ...prev.branchByPath, [normalizedPath]: event.branch } };
      });
    });
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);
  }

  if (api.teams?.onToolApprovalEvent) {
    const cleanup = api.teams.onToolApprovalEvent((_event: unknown, data: unknown) => {
      const event = data as ToolApprovalEvent;
      if ('autoResolved' in event && event.autoResolved) {
        const allowed = event.reason !== 'timeout_deny';
        useStore.setState((s) => {
          const next = new Map(s.resolvedApprovals);
          next.set(event.requestId, allowed);
          return {
            pendingApprovals: s.pendingApprovals.filter(
              (a) => !(a.runId === event.runId && a.requestId === event.requestId)
            ),
            resolvedApprovals: next,
          };
        });
      } else if ('dismissed' in event && event.dismissed) {
        const dismiss = event;
        useStore.setState((s) => ({
          pendingApprovals: s.pendingApprovals.filter(
            (a) => !(a.teamName === dismiss.teamName && a.runId === dismiss.runId)
          ),
        }));
      } else {
        const request = event as ToolApprovalRequest;
        useStore.setState((s) => ({
          pendingApprovals: [...s.pendingApprovals, request],
        }));
      }
    });
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);

    const savedSettings = useStore.getState().toolApprovalSettings;
    const activeTeam = useStore.getState().selectedTeamName ?? '__global__';
    api.teams.updateToolApprovalSettings?.(activeTeam, savedSettings).catch(() => {});
  }

  if (api.ssh?.onStatus) {
    const cleanup = api.ssh.onStatus((_event: unknown, status: unknown) => {
      const s = status as { state: string; host: string | null; error: string | null };
      useStore
        .getState()
        .setConnectionStatus(
          s.state as 'disconnected' | 'connecting' | 'connected' | 'error',
          s.host,
          s.error
        );
    });
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);
  }

  if (api.context?.onChanged) {
    const cleanup = api.context.onChanged((_event: unknown, data: unknown) => {
      const { id } = data as { id: string; type: string };
      const currentContextId = useStore.getState().activeContextId;
      if (id !== currentContextId) {
        void useStore.getState().switchContext(id);
      }
    });
    if (typeof cleanup === 'function') cleanupFns.push(cleanup);
  }

  return () => {
    for (const timer of pendingSessionRefreshTimers.values()) clearTimeout(timer);
    pendingSessionRefreshTimers.clear();
    for (const timer of pendingProjectRefreshTimers.values()) clearTimeout(timer);
    pendingProjectRefreshTimers.clear();
    cleanupFns.forEach((fn) => fn());
  };
}
