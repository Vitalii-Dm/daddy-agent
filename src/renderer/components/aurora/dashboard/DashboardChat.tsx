import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { InboxMessage } from '@shared/types/team';

import { useStore } from '@renderer/store';

import { LiquidGlass } from '../LiquidGlass';
import { Mascot, inferMascotRole } from '../Mascot';

interface DashboardChatProps {
  teamName: string;
}

// Inline chat panel for the dashboard right column. Displays the team's inbox
// messages as a scrollable chat, newest at bottom. User messages are
// right-aligned; agent messages left-aligned with a mascot avatar.
export const DashboardChat = ({ teamName }: DashboardChatProps): React.JSX.Element => {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const messages = useStore((s) => s.selectedTeamData?.messages ?? []);
  const sendTeamMessage = useStore((s) => s.sendTeamMessage);
  const sendingMessage = useStore((s) => s.sendingMessage);

  // Auto-scroll to bottom when messages change.
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
    <LiquidGlass radius={26} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--glass-shade)' }}
      >
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 2.5A1.5 1.5 0 0 1 3.5 1h7A1.5 1.5 0 0 1 12 2.5v6A1.5 1.5 0 0 1 10.5 10H8l-3 3v-3H3.5A1.5 1.5 0 0 1 2 8.5v-6Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
              className="text-[color:var(--ink-2)]"
            />
          </svg>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
            Chat
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--ink-3)]">
          {messages.length}
        </span>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        style={{ minHeight: '120px' }}
      >
        {messages.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-[color:var(--ink-3)]">
            No messages yet. Send one to the lead.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.slice(-60).map((msg, idx) => (
              <ChatBubble key={msg.messageId ?? `msg-${idx}`} msg={msg} />
            ))}
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
          className="min-w-0 flex-1 rounded-full border border-white/25 bg-white/20 px-3.5 py-1.5 text-[13px] text-[color:var(--ink-1)] placeholder:text-[color:var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[color:var(--a-violet)] disabled:opacity-50"
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

const ChatBubble = ({ msg }: { msg: InboxMessage }): React.JSX.Element => {
  const isUser = msg.from === 'user';
  const role = inferMascotRole(msg.from);
  const timeLabel = relativeTime(msg.timestamp);

  return (
    <li className={'flex gap-2 ' + (isUser ? 'flex-row-reverse' : 'flex-row')}>
      {!isUser && (
        <div className="shrink-0 self-end">
          <Mascot role={role} size={24} seed={msg.from} />
        </div>
      )}
      <div
        className={'flex max-w-[82%] flex-col gap-0.5 ' + (isUser ? 'items-end' : 'items-start')}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ink-3)]">
          {isUser ? 'You' : (msg.from ?? 'Agent')}
          {timeLabel ? ` · ${timeLabel}` : ''}
        </span>
        <span
          className={
            'rounded-2xl px-3 py-1.5 text-[13px] leading-snug ' +
            (isUser
              ? 'bg-[color:var(--a-violet)] text-white'
              : 'border border-white/55 bg-white/60 text-[color:var(--ink-1)]')
          }
          style={isUser ? undefined : { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }}
        >
          {typeof msg.text === 'string' ? msg.text : '[message]'}
        </span>
      </div>
    </li>
  );
};

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
