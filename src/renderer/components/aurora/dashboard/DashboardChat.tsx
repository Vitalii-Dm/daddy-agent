import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { InboxMessage } from '@shared/types/team';

import { useStore } from '@renderer/store';
import { stripAgentBlocks } from '@shared/constants/agentBlocks';

import { GlassButton } from '@renderer/components/ui/GlassButton';

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
  const members = useStore((s) => s.selectedTeamData?.members ?? []);
  const sendTeamMessage = useStore((s) => s.sendTeamMessage);
  const sendingMessage = useStore((s) => s.sendingMessage);

  // Resolve actual lead member name (e.g. "team-lead") instead of hardcoded "lead"
  const leadMemberName = members.find((m) => m.agentType === 'team-lead')?.name ?? 'team-lead';

  // Anchor the panel at the start of the chat (oldest messages visible first).
  // The user scrolls down manually; we don't pin to the bottom on new messages.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendingMessage) return;
    void sendTeamMessage(teamName, {
      member: leadMemberName,
      text: trimmed,
      from: 'user',
      source: 'user_sent',
    });
    setText('');
    inputRef.current?.focus();
  }, [text, sendingMessage, sendTeamMessage, teamName, leadMemberName]);

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
      radius={26}
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ flex: '1 1 auto' }}
    >
      {/* Header — sticky chat label row */}
      <div
        className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b px-4 py-3"
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

      {/* Message list — only this scrolls. */}
      <div
        ref={listRef}
        data-lenis-prevent
        className="glass-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-[color:var(--ink-3)]">
            No messages yet. Send one to the lead.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages
              .filter((msg) => {
                if (typeof msg.text !== 'string') return true;
                const text = msg.text;
                // Hide internal system messages: idle notifications, JSON payloads, etc.
                if (text.startsWith('{') && text.includes('"type"')) return false;
                // Hide messages that are only agent blocks (internal instructions)
                if (stripAgentBlocks(text).trim().length === 0) return false;
                return true;
              })
              .map((msg, idx) => (
                <ChatBubble key={msg.messageId ?? `msg-${idx}`} msg={msg} />
              ))}
          </ul>
        )}
      </div>

      {/* Composer — sticky at panel bottom */}
      <div
        className="sticky bottom-0 z-10 flex shrink-0 items-center gap-2 border-t px-3 py-2.5"
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
        <GlassButton
          variant="primary"
          disabled={!text.trim() || sendingMessage}
          onClick={handleSend}
          aria-label="Send message"
          className="size-10 shrink-0 rounded-full px-0"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <path d="M1 12L12 6.5 1 1v4l8 1.5-8 1.5v4z" fill="currentColor" />
          </svg>
        </GlassButton>
      </div>
    </LiquidGlass>
  );
};

const ChatBubble = ({ msg }: { msg: InboxMessage }): React.JSX.Element => {
  const isUser = msg.from === 'user';
  // Resolve the sender's mascot role from the team store so each
  // agent's avatar matches their roster identity — name-only regex
  // produced four blue blobs for alice/tom/bob/jack.
  const member = useStore((s) => s.selectedTeamData?.members.find((m) => m.name === msg.from));
  const role = inferMascotRole(member?.role ?? member?.agentType ?? msg.from);
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
          {typeof msg.text === 'string'
            ? stripAgentBlocks(msg.text).trim() || '[message]'
            : '[message]'}
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
