import { localKv } from '@renderer/services/storage';

const STORAGE_PREFIX = 'team-messages-read:';

function storageKey(teamName: string): string {
  return `${STORAGE_PREFIX}${teamName}`;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function getReadSet(teamName: string): Set<string> {
  const arr = localKv.getJson<string[]>(storageKey(teamName), isStringArray, []);
  return new Set(arr);
}

/**
 * Mark a message as read and persist. If `fullSet` is provided, that set is written
 * (avoids losing keys when a previous write failed). Otherwise reads from storage and adds one key.
 */
export function markRead(teamName: string, messageKey: string, fullSet?: Set<string>): void {
  const toWrite =
    fullSet ??
    (() => {
      const set = getReadSet(teamName);
      if (set.has(messageKey)) return null;
      set.add(messageKey);
      return set;
    })();
  if (!toWrite) return;
  localKv.setJson(storageKey(teamName), [...toWrite]);
}

/**
 * Persist a full set of read keys at once (bulk mark-all-as-read).
 */
export function markBulkRead(teamName: string, fullSet: Set<string>): void {
  localKv.setJson(storageKey(teamName), [...fullSet]);
}
