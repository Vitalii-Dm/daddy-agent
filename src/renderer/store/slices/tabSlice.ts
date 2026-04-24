/**
 * Tab slice - manages tab state and actions.
 *
 * Facade pattern: All tab mutations operate on the paneLayout and sync
 * root-level openTabs/activeTabId/selectedTabIds from the focused pane
 * for backward compatibility.
 */

import { truncateLabel } from '@renderer/types/tabs';
import { normalizePath } from '@renderer/utils/pathNormalize';

import {
  findPane,
  findPaneByTabId,
  getAllTabs,
  removePane as removePaneHelper,
  syncFocusedPaneState,
  updatePane,
} from '../utils/paneHelpers';
import { getFullResetState, getWorktreeNavigationState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { PaneLayout } from '@renderer/types/panes';
import type { OpenTabOptions, Tab, TabInput } from '@renderer/types/tabs';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface TabSlice {
  // State (synced from focused pane for backward compat)
  openTabs: Tab[];
  activeTabId: string | null;
  selectedTabIds: string[];

  // Project context state
  activeProjectId: string | null;

  // Actions
  openTab: (tab: TabInput, options?: OpenTabOptions) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  getActiveTab: () => Tab | null;

  // Project context actions
  setActiveProject: (projectId: string) => void;
  clearActiveProject: () => void;

  // Per-tab UI state actions
  setTabContextPanelVisible: (tabId: string, visible: boolean) => void;
  updateTabLabel: (tabId: string, label: string) => void;

  // Multi-select actions
  setSelectedTabIds: (ids: string[]) => void;
  clearTabSelection: () => void;

  // Bulk close actions
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
  closeTabs: (tabIds: string[]) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sync root-level state from the focused pane.
 */
function syncFromLayout(layout: PaneLayout): Record<string, unknown> {
  const synced = syncFocusedPaneState(layout);
  return {
    paneLayout: layout,
    openTabs: synced.openTabs,
    activeTabId: synced.activeTabId,
    selectedTabIds: synced.selectedTabIds,
  };
}

/**
 * Update a tab in whichever pane contains it, returning the new layout.
 */
function updateTabInLayout(
  layout: PaneLayout,
  tabId: string,
  updater: (tab: Tab) => Tab
): PaneLayout {
  const pane = findPaneByTabId(layout, tabId);
  if (!pane) return layout;
  return updatePane(layout, {
    ...pane,
    tabs: pane.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
  });
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createTabSlice: StateCreator<AppState, [], [], TabSlice> = (set, get) => ({
  // Initial state (synced from focused pane)
  openTabs: [],
  activeTabId: null,
  selectedTabIds: [],

  // Project context state
  activeProjectId: null,

  // Open a tab in the focused pane
  openTab: (tab: TabInput, options?: OpenTabOptions) => {
    const state = get();
    const { paneLayout } = state;
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    // Create new tab with generated id and timestamp
    const newTab: Tab = {
      ...tab,
      id: crypto.randomUUID(),
      label: truncateLabel(tab.label),
      createdAt: Date.now(),
    };

    const updatedPane = {
      ...focusedPane,
      tabs: [...focusedPane.tabs, newTab],
      activeTabId: newTab.id,
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Suppress unused variable warning — options may be used by callers for future extensions
    void options;
  },

  // Close a tab by ID in whichever pane contains it
  closeTab: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const index = pane.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    // Cleanup per-tab UI state
    state.cleanupTabUIState(tabId);

    const newTabs = pane.tabs.filter((t) => t.id !== tabId);

    // Determine new active tab within this pane
    let newActiveId = pane.activeTabId;
    if (pane.activeTabId === tabId) {
      newActiveId = newTabs[index]?.id ?? newTabs[index - 1]?.id ?? null;
    }

    // If pane becomes empty and it's not the only pane, close the pane
    if (newTabs.length === 0 && paneLayout.panes.length > 1) {
      state.closePane(pane.id);
      return;
    }

    // If all tabs across all panes are gone, reset to initial state
    const allOtherTabs = paneLayout.panes.filter((p) => p.id !== pane.id).flatMap((p) => p.tabs);
    if (newTabs.length === 0 && allOtherTabs.length === 0) {
      const updatedPane = { ...pane, tabs: [], activeTabId: null, selectedTabIds: [] };
      const newLayout = updatePane(paneLayout, updatedPane);
      set({
        ...syncFromLayout(newLayout),
        ...getFullResetState(),
      });
      return;
    }

    const updatedPane = {
      ...pane,
      tabs: newTabs,
      activeTabId: newActiveId,
      selectedTabIds: pane.selectedTabIds.filter((id) => id !== tabId),
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Sync sidebar state for the newly active tab
    if (newActiveId) {
      get().setActiveTab(newActiveId);
    }
  },

  // Switch focus to an existing tab
  setActiveTab: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;

    // Find which pane contains this tab
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Update pane's activeTabId and focus the pane
    const updatedPane = { ...pane, activeTabId: tabId };
    let newLayout = updatePane(paneLayout, updatedPane);
    newLayout = { ...newLayout, focusedPaneId: pane.id };
    set(syncFromLayout(newLayout));

    // For team and graph tabs, re-select the team so global selectedTeamData matches this tab.
    if ((tab.type === 'team' || tab.type === 'graph') && tab.teamName) {
      if (state.selectedTeamName !== tab.teamName) {
        // Different team -- full reload (also auto-selects project via selectTeam)
        void state.selectTeam(tab.teamName);
      } else {
        // Same team already loaded -- just sync sidebar project if team has a projectPath.
        const teamData = state.selectedTeamData;
        const projectPath = teamData?.config.projectPath;
        if (projectPath) {
          const normalizedTeamPath = normalizePath(projectPath);
          const matchingProject = state.projects.find(
            (p) => normalizePath(p.path) === normalizedTeamPath
          );
          if (matchingProject && state.selectedProjectId !== matchingProject.id) {
            state.selectProject(matchingProject.id);
          } else if (!matchingProject) {
            for (const repo of state.repositoryGroups) {
              const matchingWorktree = repo.worktrees.find(
                (wt) => normalizePath(wt.path) === normalizedTeamPath
              );
              if (matchingWorktree && state.selectedWorktreeId !== matchingWorktree.id) {
                set(getWorktreeNavigationState(repo.id, matchingWorktree.id));
                void get().fetchSessionsInitial(matchingWorktree.id);
                break;
              }
            }
          }
        }
      }
    }
  },

  // Get the currently active tab (from the focused pane)
  getActiveTab: () => {
    const state = get();
    const focusedPane = findPane(state.paneLayout, state.paneLayout.focusedPaneId);
    if (!focusedPane?.activeTabId) return null;
    return focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? null;
  },

  // Update a tab's label
  updateTabLabel: (tabId: string, label: string) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      label,
    }));
    set(syncFromLayout(newLayout));
  },

  // Set context panel visibility for a specific tab (no-op: showContextPanel removed from Tab type)
  setTabContextPanelVisible: (_tabId: string, _visible: boolean) => {
    // Tab type no longer supports showContextPanel
  },

  // Set multi-selected tab IDs (within the focused pane)
  setSelectedTabIds: (ids: string[]) => {
    const { paneLayout } = get();
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const updatedPane = { ...focusedPane, selectedTabIds: ids };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  // Clear multi-selection in the focused pane
  clearTabSelection: () => {
    const { paneLayout } = get();
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const updatedPane = { ...focusedPane, selectedTabIds: [] };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  // Close all tabs except the specified one (within the pane containing the tab)
  closeOtherTabs: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const tabsToClose = pane.tabs.filter((t) => t.id !== tabId);
    for (const tab of tabsToClose) {
      state.cleanupTabUIState(tab.id);
    }

    const keepTab = pane.tabs.find((t) => t.id === tabId);
    if (!keepTab) return;

    const updatedPane = {
      ...pane,
      tabs: [keepTab],
      activeTabId: tabId,
      selectedTabIds: [],
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Sync sidebar state for the remaining tab
    get().setActiveTab(tabId);
  },

  // Close all tabs to the right (within the pane containing the tab)
  closeTabsToRight: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const index = pane.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const tabsToClose = pane.tabs.slice(index + 1);
    for (const tab of tabsToClose) {
      state.cleanupTabUIState(tab.id);
    }

    const newTabs = pane.tabs.slice(0, index + 1);
    const activeStillExists = newTabs.some((t) => t.id === pane.activeTabId);
    const newActiveId = activeStillExists ? pane.activeTabId : tabId;
    const updatedPane = {
      ...pane,
      tabs: newTabs,
      activeTabId: newActiveId,
      selectedTabIds: [],
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Sync sidebar state for the active tab
    if (newActiveId) {
      get().setActiveTab(newActiveId);
    }
  },

  // Close all tabs across all panes, reset to initial state
  closeAllTabs: () => {
    const state = get();
    const allTabs = getAllTabs(state.paneLayout);
    for (const tab of allTabs) {
      state.cleanupTabUIState(tab.id);
    }

    // Reset to single empty pane
    const defaultPaneId = state.paneLayout.panes[0]?.id ?? 'pane-default';
    const newLayout: PaneLayout = {
      panes: [
        {
          id: defaultPaneId,
          tabs: [],
          activeTabId: null,
          selectedTabIds: [],
          widthFraction: 1,
        },
      ],
      focusedPaneId: defaultPaneId,
    };

    set({
      ...syncFromLayout(newLayout),
      ...getFullResetState(),
    });
  },

  // Close multiple tabs by ID (within the pane containing them)
  closeTabs: (tabIds: string[]) => {
    const state = get();
    const idSet = new Set(tabIds);

    // Cleanup UI state
    for (const id of idSet) {
      state.cleanupTabUIState(id);
    }

    // Group tabs by pane for batch removal
    let { paneLayout } = state;
    const panesToRemove: string[] = [];

    for (const pane of paneLayout.panes) {
      const remainingTabs = pane.tabs.filter((t) => !idSet.has(t.id));

      if (remainingTabs.length === pane.tabs.length) continue; // No tabs removed from this pane

      if (remainingTabs.length === 0 && paneLayout.panes.length > 1) {
        panesToRemove.push(pane.id);
        continue;
      }

      // Determine new active tab
      let newActiveId = pane.activeTabId;
      if (newActiveId && idSet.has(newActiveId)) {
        const oldIndex = pane.tabs.findIndex((t) => t.id === newActiveId);
        newActiveId = null;
        for (let i = oldIndex; i < pane.tabs.length; i++) {
          if (!idSet.has(pane.tabs[i].id)) {
            newActiveId = pane.tabs[i].id;
            break;
          }
        }
        if (!newActiveId) {
          for (let i = oldIndex - 1; i >= 0; i--) {
            if (!idSet.has(pane.tabs[i].id)) {
              newActiveId = pane.tabs[i].id;
              break;
            }
          }
        }
        newActiveId = newActiveId ?? remainingTabs[0]?.id ?? null;
      }

      paneLayout = updatePane(paneLayout, {
        ...pane,
        tabs: remainingTabs,
        activeTabId: newActiveId,
        selectedTabIds: pane.selectedTabIds.filter((id) => !idSet.has(id)),
      });
    }

    // Check if ALL tabs are now gone
    const allRemainingTabs = getAllTabs(paneLayout);
    if (allRemainingTabs.length === 0) {
      state.closeAllTabs();
      return;
    }

    // Remove empty panes
    for (const paneId of panesToRemove) {
      paneLayout = removePaneHelper(paneLayout, paneId);
    }

    set(syncFromLayout(paneLayout));

    // Sync sidebar state for the new active tab
    const newActiveTabId = get().activeTabId;
    if (newActiveTabId) {
      get().setActiveTab(newActiveTabId);
    }
  },

  // Set active project and fetch its sessions
  setActiveProject: (projectId: string) => {
    set({ activeProjectId: projectId });
    get().selectProject(projectId);
  },

  clearActiveProject: () => {
    set({
      activeProjectId: null,
      selectedProjectId: null,
      selectedRepositoryId: null,
      selectedWorktreeId: null,
    });
  },
});
