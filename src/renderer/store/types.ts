import type { ConfigSlice } from './slices/configSlice';
import type { ConnectionSlice } from './slices/connectionSlice';
import type { ContextSlice } from './slices/contextSlice';
import type { ConversationSlice } from './slices/conversationSlice';
import type { PaneSlice } from './slices/paneSlice';
import type { ProjectSlice } from './slices/projectSlice';
import type { RepositorySlice } from './slices/repositorySlice';
import type { SessionDetailSlice } from './slices/sessionDetailSlice';
import type { SessionSlice } from './slices/sessionSlice';
import type { SubagentSlice } from './slices/subagentSlice';
import type { TabSlice } from './slices/tabSlice';
import type { TabUISlice } from './slices/tabUISlice';
import type { TeamSlice } from './slices/teamSlice';
import type { UISlice } from './slices/uiSlice';

export interface BreadcrumbItem {
  id: string;
  description: string;
}

export interface SearchMatch {
  itemId: string;
  itemType: 'user' | 'ai';
  matchIndexInItem: number;
  globalIndex: number;
  displayItemId?: string;
}

export interface SearchNavigationContext {
  query: string;
  messageTimestamp: number;
  matchedText: string;
  targetGroupId?: string;
  targetMatchIndexInItem?: number;
  targetMatchStartOffset?: number;
  targetMessageUuid?: string;
}

export type AppState = ProjectSlice &
  RepositorySlice &
  SessionSlice &
  SessionDetailSlice &
  SubagentSlice &
  TeamSlice &
  ConversationSlice &
  TabSlice &
  TabUISlice &
  PaneSlice &
  UISlice &
  ConfigSlice &
  ConnectionSlice &
  ContextSlice;
