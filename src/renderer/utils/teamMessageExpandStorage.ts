import { localKv } from '@renderer/services/storage';

const STORAGE_PREFIX = 'team-msg-expanded:';

function storageKey(teamName: string): string {
  return `${STORAGE_PREFIX}${teamName}`;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function getExpandedOverrides(teamName: string): Set<string> {
  const arr = localKv.getJson<string[]>(storageKey(teamName), isStringArray, []);
  return new Set(arr);
}

export function addExpanded(teamName: string, messageKey: string): void {
  const set = getExpandedOverrides(teamName);
  if (set.has(messageKey)) return;
  set.add(messageKey);
  localKv.setJson(storageKey(teamName), [...set]);
}

export function removeExpanded(teamName: string, messageKey: string): void {
  const set = getExpandedOverrides(teamName);
  if (!set.has(messageKey)) return;
  set.delete(messageKey);
  localKv.setJson(storageKey(teamName), [...set]);
}
