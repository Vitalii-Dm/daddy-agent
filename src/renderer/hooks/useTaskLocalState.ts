import { useCallback, useMemo, useState } from 'react';

import { localKv } from '@renderer/services/storage';

const PINNED_KEY = 'taskPinnedIds';
const ARCHIVED_KEY = 'taskArchivedIds';
const RENAMED_KEY = 'taskRenamedSubjects';

function makeCompositeKey(teamName: string, taskId: string): string {
  return `${teamName}:${taskId}`;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

function loadSet(key: string): Set<string> {
  return new Set(localKv.getJson<string[]>(key, isStringArray, []));
}

function saveSet(key: string, set: Set<string>): void {
  localKv.setJson(key, [...set]);
}

function loadMap(key: string): Map<string, string> {
  return new Map(Object.entries(localKv.getJson<Record<string, string>>(key, isStringRecord, {})));
}

function saveMap(key: string, map: Map<string, string>): void {
  localKv.setJson(key, Object.fromEntries(map));
}

export interface TaskLocalState {
  pinnedIds: Set<string>;
  archivedIds: Set<string>;
  renamedSubjects: Map<string, string>;

  isPinned: (teamName: string, taskId: string) => boolean;
  isArchived: (teamName: string, taskId: string) => boolean;
  getRenamedSubject: (teamName: string, taskId: string) => string | undefined;

  togglePin: (teamName: string, taskId: string) => void;
  toggleArchive: (teamName: string, taskId: string) => void;
  renameTask: (teamName: string, taskId: string, newSubject: string) => void;
}

export function useTaskLocalState(): TaskLocalState {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadSet(PINNED_KEY));
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => loadSet(ARCHIVED_KEY));
  const [renamedSubjects, setRenamedSubjects] = useState<Map<string, string>>(() =>
    loadMap(RENAMED_KEY)
  );

  const isPinned = useCallback(
    (teamName: string, taskId: string): boolean =>
      pinnedIds.has(makeCompositeKey(teamName, taskId)),
    [pinnedIds]
  );

  const isArchived = useCallback(
    (teamName: string, taskId: string): boolean =>
      archivedIds.has(makeCompositeKey(teamName, taskId)),
    [archivedIds]
  );

  const getRenamedSubject = useCallback(
    (teamName: string, taskId: string): string | undefined =>
      renamedSubjects.get(makeCompositeKey(teamName, taskId)),
    [renamedSubjects]
  );

  const togglePin = useCallback((teamName: string, taskId: string): void => {
    const key = makeCompositeKey(teamName, taskId);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveSet(PINNED_KEY, next);
      return next;
    });
  }, []);

  const toggleArchive = useCallback((teamName: string, taskId: string): void => {
    const key = makeCompositeKey(teamName, taskId);
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveSet(ARCHIVED_KEY, next);
      return next;
    });
  }, []);

  const renameTask = useCallback((teamName: string, taskId: string, newSubject: string): void => {
    const key = makeCompositeKey(teamName, taskId);
    setRenamedSubjects((prev) => {
      const next = new Map(prev);
      const trimmed = newSubject.trim();
      if (trimmed) {
        next.set(key, trimmed);
      } else {
        next.delete(key);
      }
      saveMap(RENAMED_KEY, next);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      pinnedIds,
      archivedIds,
      renamedSubjects,
      isPinned,
      isArchived,
      getRenamedSubject,
      togglePin,
      toggleArchive,
      renameTask,
    }),
    [
      pinnedIds,
      archivedIds,
      renamedSubjects,
      isPinned,
      isArchived,
      getRenamedSubject,
      togglePin,
      toggleArchive,
      renameTask,
    ]
  );
}
