import type { TriggerColor } from '@shared/constants/triggerColors';

import type { Session } from './data';

export interface Tab {
  id: string;
  type: 'teams' | 'team' | 'graph';
  teamName?: string;
  label: string;
  createdAt: number;
}

export interface OpenTabOptions {
  forceNewTab?: boolean;
  replaceActiveTab?: boolean;
}

export type TabInput = Omit<Tab, 'id' | 'createdAt'>;

const TAB_LABEL_MAX_LENGTH = 50;

export function truncateLabel(label: string): string {
  if (label.length <= TAB_LABEL_MAX_LENGTH) return label;
  return label.slice(0, TAB_LABEL_MAX_LENGTH - 1) + '…';
}

// ---------------------------------------------------------------------------
// Date grouping types (used by sidebar session list)
// ---------------------------------------------------------------------------

export type DateCategory = 'Today' | 'Yesterday' | 'Previous 7 Days' | 'Older';

export type DateGroupedSessions = Record<DateCategory, Session[]>;

export const DATE_CATEGORY_ORDER: DateCategory[] = [
  'Today',
  'Yesterday',
  'Previous 7 Days',
  'Older',
];

// ---------------------------------------------------------------------------
// Tab navigation request types (used by useTabNavigationController)
// ---------------------------------------------------------------------------

export interface ErrorNavigationPayload {
  errorTimestamp: number;
  toolUseId?: string;
  subagentId?: string;
}

export interface SearchNavigationPayload {
  query: string;
  messageTimestamp: number;
  targetGroupId?: string;
  targetMatchIndexInItem?: number;
}

export interface ErrorTabNavigationRequest {
  kind: 'error';
  id: string;
  payload: ErrorNavigationPayload;
  highlight?: TriggerColor | 'none';
}

export interface SearchTabNavigationRequest {
  kind: 'search';
  id: string;
  payload: SearchNavigationPayload;
  highlight?: TriggerColor | 'none';
}

export interface AutoBottomTabNavigationRequest {
  kind: 'autoBottom';
  id: string;
}

export type TabNavigationRequest =
  | ErrorTabNavigationRequest
  | SearchTabNavigationRequest
  | AutoBottomTabNavigationRequest;

export function isErrorPayload(
  request: TabNavigationRequest
): request is ErrorTabNavigationRequest {
  return request.kind === 'error';
}

export function isSearchPayload(
  request: TabNavigationRequest
): request is SearchTabNavigationRequest {
  return request.kind === 'search';
}
