import { useCallback, useEffect, useState } from 'react';

import { localKv } from '@renderer/services/storage';
import { useStore } from '@renderer/store';

// Legacy key predates the `daddy:<feature>:<suffix>` convention. Kept as-is
// so existing installs don't lose their toggle state.
const GRAPH_SIDEBAR_VISIBILITY_STORAGE_KEY = 'team-graph-sidebar-visible';

function readInitialVisibility(): boolean {
  return localKv.getString(GRAPH_SIDEBAR_VISIBILITY_STORAGE_KEY) !== 'false';
}

export function useGraphSidebarVisibility(): {
  sidebarVisible: boolean;
  toggleSidebarVisible: () => void;
} {
  const [sidebarEnabled, setSidebarEnabled] = useState<boolean>(readInitialVisibility);
  const messagesPanelMode = useStore((state) => state.messagesPanelMode);
  const setMessagesPanelMode = useStore((state) => state.setMessagesPanelMode);
  const sidebarVisible = sidebarEnabled && messagesPanelMode === 'sidebar';

  useEffect(() => {
    localKv.setString(GRAPH_SIDEBAR_VISIBILITY_STORAGE_KEY, String(sidebarEnabled));
  }, [sidebarEnabled]);

  const toggleSidebarVisible = useCallback(() => {
    if (sidebarVisible) {
      setSidebarEnabled(false);
      return;
    }

    setSidebarEnabled(true);
    if (messagesPanelMode !== 'sidebar') {
      setMessagesPanelMode('sidebar');
    }
  }, [messagesPanelMode, setMessagesPanelMode, sidebarVisible]);

  return {
    sidebarVisible,
    toggleSidebarVisible,
  };
}
