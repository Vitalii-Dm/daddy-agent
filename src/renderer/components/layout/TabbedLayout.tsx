import { useCallback, useState } from 'react';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { isElectronMode } from '@renderer/api';
import { getTrafficLightPaddingForZoom } from '@renderer/constants/layout';
import { useFullScreen } from '@renderer/hooks/useFullScreen';
import { useKeyboardShortcuts } from '@renderer/hooks/useKeyboardShortcuts';
import { useZoomFactor } from '@renderer/hooks/useZoomFactor';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { CustomTitleBar } from './CustomTitleBar';
import { PaneContainer } from './PaneContainer';
import { Sidebar } from './Sidebar';
import { DragOverlayTab } from './SortableTab';
import { TabBarRow } from './TabBarRow';

import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { Tab } from '@renderer/types/tabs';

export const TabbedLayout = (): React.JSX.Element => {
  useKeyboardShortcuts();
  const zoomFactor = useZoomFactor();
  const isFullScreen = useFullScreen();
  const trafficLightPadding = !isElectronMode()
    ? 0
    : isFullScreen
      ? 8
      : getTrafficLightPaddingForZoom(zoomFactor);

  const panes = useStore(useShallow((s) => s.paneLayout.panes));
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const data = active.data.current;

      if (data?.type === 'tab') {
        const sourcePaneId = data.paneId as string;
        const tabId = data.tabId as string;

        const pane = panes.find((p) => p.id === sourcePaneId);
        const tab = pane?.tabs.find((t) => t.id === tabId);
        if (tab) {
          setActiveTab(tab);
        }
      }
    },
    [panes]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveTab(null);

      if (!over || !active.data.current) return;

      const activeData = active.data.current;
      const overData = over.data.current;

      if (activeData.type !== 'tab') return;

      const draggedTabId = activeData.tabId as string;
      const sourcePaneId = activeData.paneId as string;
      const state = useStore.getState();

      if (overData?.type === 'split-zone') {
        const targetPaneId = overData.paneId as string;
        const side = overData.side as 'left' | 'right';
        state.moveTabToNewPane(draggedTabId, sourcePaneId, targetPaneId, side);
        return;
      }

      if (overData?.type === 'tabbar') {
        const targetPaneId = overData.paneId as string;
        if (sourcePaneId !== targetPaneId) {
          state.moveTabToPane(draggedTabId, sourcePaneId, targetPaneId);
        }
        return;
      }

      if (overData?.type === 'tab') {
        const overTabId = overData.tabId as string;
        const overPaneId = overData.paneId as string;

        if (sourcePaneId === overPaneId) {
          const pane = panes.find((p) => p.id === sourcePaneId);
          if (!pane) return;

          const fromIndex = pane.tabs.findIndex((t) => t.id === draggedTabId);
          const toIndex = pane.tabs.findIndex((t) => t.id === overTabId);

          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            state.reorderTabInPane(sourcePaneId, fromIndex, toIndex);
          }
        } else {
          const targetPane = panes.find((p) => p.id === overPaneId);
          if (!targetPane) return;

          const insertIndex = targetPane.tabs.findIndex((t) => t.id === overTabId);
          state.moveTabToPane(draggedTabId, sourcePaneId, overPaneId, insertIndex);
        }
      }
    },
    [panes]
  );

  return (
    <div
      className="flex h-screen flex-col bg-claude-dark-bg text-claude-dark-text"
      style={
        { '--macos-traffic-light-padding-left': `${trafficLightPadding}px` } as React.CSSProperties
      }
    >
      <CustomTitleBar />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <TabBarRow />
        <div className="flex flex-1 overflow-hidden">
          <div
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
            style={{ background: 'transparent' }}
          >
            <PaneContainer />
          </div>
          <Sidebar />
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTab ? <DragOverlayTab tab={activeTab} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};
