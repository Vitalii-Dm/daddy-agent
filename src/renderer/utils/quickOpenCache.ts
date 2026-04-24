import type { QuickOpenFile } from '@shared/types/editor';

interface QuickOpenCacheEntry {
  files: QuickOpenFile[];
  timestamp: number;
}

const cacheByProject = new Map<string, QuickOpenCacheEntry>();
const listeners: (() => void)[] = [];

export function getQuickOpenCache(projectPath?: string | null): QuickOpenCacheEntry | null {
  if (!projectPath) return null;
  return cacheByProject.get(projectPath) ?? null;
}

export function setQuickOpenCache(projectPath: string, files: QuickOpenFile[]): void {
  cacheByProject.set(projectPath, { files, timestamp: Date.now() });
  listeners.forEach((fn) => fn());
}

export function invalidateQuickOpenCache(projectPath?: string): void {
  if (projectPath) {
    cacheByProject.delete(projectPath);
  } else {
    cacheByProject.clear();
  }
  listeners.forEach((fn) => fn());
}

export function onQuickOpenCacheInvalidated(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
