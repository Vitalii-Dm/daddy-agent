import React from 'react';

import { ChatHistory } from '../chat/ChatHistory';

interface MiddlePanelProps {
  /** Tab ID for per-tab state isolation (scroll position, etc.) */
  tabId?: string;
}

export const MiddlePanel: React.FC<MiddlePanelProps> = ({ tabId }) => {
  return (
    <div className="relative flex h-full flex-col">
      <ChatHistory tabId={tabId} />
    </div>
  );
};
