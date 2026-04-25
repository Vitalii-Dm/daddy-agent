import { TeamGraphTab } from '@features/agent-graph/renderer';
import { TabUIProvider } from '@renderer/contexts/TabUIContext';

import { TeamDetailView } from '../team/TeamDetailView';
import { TeamListView } from '../team/TeamListView';

import type { Pane } from '@renderer/types/panes';

interface PaneContentProps {
  pane: Pane;
  isPaneFocused: boolean;
}

export const PaneContent = ({ pane, isPaneFocused }: PaneContentProps): React.JSX.Element => {
  const activeTabId = pane.activeTabId;

  const showDefaultView = !activeTabId && pane.tabs.length === 0;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {showDefaultView && (
        <div className="absolute inset-0 flex">
          <TeamListView />
        </div>
      )}

      {pane.tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className="absolute inset-0 flex"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            {tab.type === 'teams' && <TeamListView />}
            {tab.type === 'team' && (
              <TabUIProvider tabId={tab.id}>
                <TeamDetailView teamName={tab.teamName ?? ''} isPaneFocused={isPaneFocused} />
              </TabUIProvider>
            )}
            {tab.type === 'graph' && (
              <TabUIProvider tabId={tab.id}>
                <TeamGraphTab
                  teamName={tab.teamName ?? ''}
                  isActive={isActive}
                  isPaneFocused={isPaneFocused}
                />
              </TabUIProvider>
            )}
          </div>
        );
      })}
    </div>
  );
};
