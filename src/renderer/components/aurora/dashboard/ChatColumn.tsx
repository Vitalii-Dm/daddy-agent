import React, { useState } from 'react';

import { LiquidGlass } from '../LiquidGlass';

import { ActivityStream } from './ActivityStream';
import { DashboardChat } from './DashboardChat';

interface ChatColumnProps {
  teamName: string;
  onSendMessageDialog: () => void;
}

type Tab = 'chat' | 'activity';

// Left-column dashboard panel. Two tabs at top — Chat / Activity —
// switchable via a tinted glass pill. Chat is the live team inbox,
// Activity is the recent-events feed that used to live in the right
// rail.
export const ChatColumn = ({
  teamName,
  onSendMessageDialog,
}: ChatColumnProps): React.JSX.Element => {
  const [tab, setTab] = useState<Tab>('chat');
  return (
    <LiquidGlass radius={26} className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <TabPill active={tab === 'chat'} onClick={() => setTab('chat')}>
          Chat
        </TabPill>
        <TabPill active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity
        </TabPill>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'chat' ? (
          <DashboardChat teamName={teamName} />
        ) : (
          <ActivityStream onSendMessage={onSendMessageDialog} />
        )}
      </div>
    </LiquidGlass>
  );
};

interface TabPillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const TabPill = ({ active, onClick, children }: TabPillProps): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={
      'inline-flex h-8 flex-1 items-center justify-center rounded-full border text-[12px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] ' +
      (active
        ? 'border-white/65 bg-white/70 text-[color:var(--ink-1)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]'
        : 'border-transparent bg-transparent text-[color:var(--ink-3)] hover:bg-white/40 hover:text-[color:var(--ink-1)]')
    }
  >
    {children}
  </button>
);
