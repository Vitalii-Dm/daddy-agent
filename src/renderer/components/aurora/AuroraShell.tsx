import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { destroyLenis, initLenis } from '@renderer/lib/lenis';
import { initializeNotificationListeners, useStore } from '@renderer/store';

import type { InboxMessage } from '@shared/types/team';

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
  recipient: string;
  fullscreen?: boolean;
  onClose: () => void;
}

function formatTime(ts: string | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function isMessageBetween(msg: InboxMessage, recipient: string): boolean {
  const from = msg.from ?? '';
  const to = msg.to ?? '';
  // user → recipient (direct) or user → lead (broadcast, treated as visible to everyone).
  // Reverse: messages from the recipient back to the user.
  return (
    (from === 'user' && (to === recipient || to === 'lead' || to === '')) ||
    (from === recipient && (to === 'user' || to === 'lead' || to === ''))
  );
}

const AuroraChatPanel = ({
  teamName,
  recipient,
  fullscreen = false,
  onClose,
}: AuroraChatPanelProps): React.JSX.Element => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const allMessages = useStore((s) => s.selectedTeamData?.messages ?? []);
  const sendTeamMessage = useStore((s) => s.sendTeamMessage);
  const sendingMessage = useStore((s) => s.sendingMessage);

  const messages = useMemo(() => {
    // Full-chat view shows the entire team feed (matches DashboardChat).
    // Per-member view filters to the user ↔ recipient thread + broadcasts to lead.
    if (fullscreen) return allMessages.slice(-200);
    return allMessages.filter((m) => isMessageBetween(m, recipient)).slice(-100);
  }, [allMessages, recipient, fullscreen]);

  // Auto-resize the composer textarea up to a cap
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  // Scroll to bottom when messages change
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendingMessage) return;
    void sendTeamMessage(teamName, {
      member: recipient,
      text: trimmed,
      from: 'user',
      source: 'user_sent',
    });
    setText('');
    textareaRef.current?.focus();
  }, [text, sendingMessage, sendTeamMessage, teamName, recipient]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const panelClassName = fullscreen
    ? 'fixed inset-4 z-50 mx-auto flex max-w-[1080px] flex-col overflow-hidden sm:inset-8'
    : 'fixed bottom-6 right-6 z-50 flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden';
  const panelStyle: React.CSSProperties = fullscreen
    ? { height: 'auto' }
    : { height: 'min(620px, calc(100vh - 120px))' };

  return (
    <>
      {fullscreen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(20, 19, 26, 0.32)', backdropFilter: 'blur(8px)' }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <LiquidGlass radius={20} shadow="lifted" className={panelClassName} style={panelStyle}>
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: 'var(--glass-shade)' }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium uppercase text-white"
              style={{
                background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
              }}
              aria-hidden="true"
            >
              {recipient.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium leading-tight text-[color:var(--ink-1)]">
                {fullscreen ? `${teamName} · Team feed` : recipient}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-3)]">
                {fullscreen ? 'All messages' : 'Direct message'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close chat"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--ink-3)] transition-colors hover:bg-white/40 hover:text-[color:var(--ink-1)]"
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
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-center text-[12px] text-[color:var(--ink-3)]">
                No messages yet — say hi to {recipient}.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {messages.map((msg, idx) => {
                const isUser = msg.from === 'user';
                const prev = messages[idx - 1];
                const showLabel = !prev || prev.from !== msg.from;
                return (
                  <li
                    key={msg.messageId ?? `${msg.timestamp ?? idx}-${idx}`}
                    className={'flex flex-col gap-0.5 ' + (isUser ? 'items-end' : 'items-start')}
                  >
                    {showLabel && (
                      <span className="px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--ink-3)]">
                        {isUser ? 'You' : (msg.from ?? 'Agent')}
                        {msg.timestamp ? ` · ${formatTime(msg.timestamp)}` : ''}
                      </span>
                    )}
                    <span
                      className={
                        'max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[13px] leading-[1.45] shadow-sm ' +
                        (isUser
                          ? 'rounded-br-md text-white'
                          : 'rounded-bl-md bg-white/55 text-[color:var(--ink-1)]')
                      }
                      style={
                        isUser
                          ? {
                              background:
                                'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
                            }
                          : undefined
                      }
                    >
                      {typeof msg.text === 'string' ? msg.text : '[message]'}
                    </span>
                  </li>
                );
              })}
              {sendingMessage && (
                <li className="flex items-end justify-end">
                  <span className="rounded-2xl rounded-br-md bg-white/40 px-3 py-1.5 text-[12px] text-[color:var(--ink-3)]">
                    Sending…
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Composer */}
        <div
          className="flex shrink-0 items-end gap-2 border-t bg-white/30 px-3 py-2.5"
          style={{ borderColor: 'var(--glass-shade)' }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${recipient}…`}
            disabled={sendingMessage}
            className="min-h-[36px] min-w-0 flex-1 resize-none rounded-2xl border border-white/40 bg-white/65 px-3.5 py-2 text-[13px] leading-[1.4] text-[color:var(--ink-1)] placeholder:text-[color:var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[color:var(--a-violet)] disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!text.trim() || sendingMessage}
            onClick={handleSend}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-200 hover:-translate-y-px disabled:translate-y-0 disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
              boxShadow: '0 6px 18px -8px rgba(124, 92, 255, 0.45)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M1 12L12 6.5 1 1v4l8 1.5-8 1.5v4z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </LiquidGlass>
    </>
  );
};

// ---------------------------------------------------------------------------
// Top-level Liquid Glass shell. Owns the aurora theme attribute, the SVG
// refraction filter, the global background, the floating top rail, the
// Lenis smooth-scroll instance, and the vertical document of sections.
// ---------------------------------------------------------------------------
export const AuroraShell = (): React.JSX.Element => {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRecipient, setChatRecipient] = useState<string>('lead');
  const [chatFullscreen, setChatFullscreen] = useState(false);
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
  // CommandBar passes a `{ recipient }` payload so the panel pre-targets the right agent.
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ recipient?: string; fullscreen?: boolean }>).detail;
      const recipient = detail?.recipient?.trim();
      setChatFullscreen(Boolean(detail?.fullscreen));
      if (recipient) {
        setChatRecipient(recipient);
        setChatOpen(true);
      } else {
        setChatOpen((prev) => !prev);
      }
    };
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
        <AuroraChatPanel
          teamName={teamName}
          recipient={chatRecipient}
          fullscreen={chatFullscreen}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
};
