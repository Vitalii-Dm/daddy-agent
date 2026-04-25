import React, { useCallback, useEffect, useRef, useState } from 'react';

import { destroyLenis, initLenis } from '@renderer/lib/lenis';
import { initializeNotificationListeners, useStore } from '@renderer/store';

import { LiquidGlass } from './LiquidGlass';
import { CommandBar } from './CommandBar';
import { GlobalBackground } from './GlobalBackground';
import { RefractFilter } from './RefractFilter';
import { TopRail } from './TopRail';
import { useAuroraTeam } from './hooks/useAuroraTeam';
import { DashboardSection } from './sections/DashboardSection';
import { GraphSectionPlaceholder } from './sections/GraphSectionPlaceholder';
import { HeroSection } from './sections/HeroSection';

// ---------------------------------------------------------------------------
// Floating chat panel — simple message list + composer, shown when the user
// clicks the chat icon in the TopRail. MessagesPanel is too heavy to mount
// standalone (20+ required props, paginated API calls, bottom-sheet modes),
// so this is a purpose-built lightweight panel for the Aurora shell.
// ---------------------------------------------------------------------------
interface AuroraChatPanelProps {
  teamName: string;
  onClose: () => void;
}

const AuroraChatPanel = ({ teamName, onClose }: AuroraChatPanelProps): React.JSX.Element => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const messages = useStore((s) => s.selectedTeamData?.messages ?? []);
  const sendTeamMessage = useStore((s) => s.sendTeamMessage);
  const sendingMessage = useStore((s) => s.sendingMessage);

  // Scroll to bottom when messages change
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendingMessage) return;
    void sendTeamMessage(teamName, {
      member: 'lead',
      text: trimmed,
      from: 'user',
      source: 'user_sent',
    });
    setText('');
    inputRef.current?.focus();
  }, [text, sendingMessage, sendTeamMessage, teamName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <LiquidGlass
      radius={20}
      shadow="lifted"
      className="fixed bottom-6 right-6 z-50 flex w-96 flex-col overflow-hidden"
      style={{ maxHeight: 'min(560px, calc(100vh - 120px))' }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--glass-shade)' }}
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 2.5A1.5 1.5 0 0 1 3.5 1h7A1.5 1.5 0 0 1 12 2.5v6A1.5 1.5 0 0 1 10.5 10H8l-3 3v-3H3.5A1.5 1.5 0 0 1 2 8.5v-6Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
              className="text-[color:var(--ink-2)]"
            />
          </svg>
          <span className="text-[13px] font-medium text-[color:var(--ink-1)]">
            Chat · {teamName}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--ink-3)] transition-colors hover:bg-white/10 hover:text-[color:var(--ink-1)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        style={{ minHeight: '160px' }}
      >
        {messages.length === 0 ? (
          <p className="text-center text-[12px] text-[color:var(--ink-3)]">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.slice(-50).map((msg, idx) => {
              const isUser = msg.from === 'user';
              return (
                <li
                  key={msg.messageId ?? idx}
                  className={'flex flex-col gap-0.5 ' + (isUser ? 'items-end' : 'items-start')}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ink-3)]">
                    {isUser ? 'You' : (msg.from ?? 'Agent')}
                  </span>
                  <span
                    className={
                      'max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug ' +
                      (isUser
                        ? 'bg-[color:var(--a-violet)] text-white'
                        : 'bg-white/10 text-[color:var(--ink-1)]')
                    }
                  >
                    {typeof msg.text === 'string' ? msg.text : '[message]'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div
        className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5"
        style={{ borderColor: 'var(--glass-shade)' }}
      >
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message lead…"
          disabled={sendingMessage}
          className="bg-white/8 min-w-0 flex-1 rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] text-[color:var(--ink-1)] placeholder:text-[color:var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[color:var(--a-violet)] disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!text.trim() || sendingMessage}
          onClick={handleSend}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 12L12 6.5 1 1v4l8 1.5-8 1.5v4z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </LiquidGlass>
  );
};

// ---------------------------------------------------------------------------
// Top-level Liquid Glass shell. Owns the aurora theme attribute, the SVG
// refraction filter, the global background, the floating top rail, the
// Lenis smooth-scroll instance, and the vertical document of sections.
// ---------------------------------------------------------------------------
export const AuroraShell = (): React.JSX.Element => {
  const [chatOpen, setChatOpen] = useState(false);
  const { teamName } = useAuroraTeam();

  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'aurora';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      initLenis();
    }
    return () => {
      destroyLenis();
      if (previous) {
        document.documentElement.dataset.theme = previous;
      } else {
        delete document.documentElement.dataset.theme;
      }
    };
  }, []);

  useEffect(() => {
    const cleanup = initializeNotificationListeners();
    return cleanup;
  }, []);

  // Toggle the chat panel when the TopRail chat button fires the custom event.
  useEffect(() => {
    const handler = (): void => setChatOpen((prev) => !prev);
    window.addEventListener('aurora:open-chat', handler as EventListener);
    return () => window.removeEventListener('aurora:open-chat', handler as EventListener);
  }, []);

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden text-[color:var(--ink-1)]"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      <RefractFilter />
      <GlobalBackground />
      <TopRail />
      <main className="relative z-0">
        <HeroSection />
        <DashboardSection />
        <GraphSectionPlaceholder />
      </main>
      <CommandBar />
      {chatOpen && teamName && (
        <AuroraChatPanel teamName={teamName} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
};
