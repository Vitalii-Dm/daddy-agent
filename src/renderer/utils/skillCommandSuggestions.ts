import type { MentionSuggestion } from '@renderer/types/mention';

export interface SkillCommandSuggestion {
  label: string;
  command: string;
}

export function buildSlashCommandSuggestions(
  _commands: readonly unknown[],
  _projectCatalog?: unknown,
  _userCatalog?: unknown,
  _providerId?: unknown
): MentionSuggestion[] {
  return [];
}

export function getSkillCommandSuggestions(
  _text: string,
  _projectCatalog?: unknown,
  _userCatalog?: unknown
): SkillCommandSuggestion[] {
  return [];
}
