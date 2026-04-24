import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import type { InboxMessage } from '@shared/types/team';

import { useStore } from '@renderer/store';

import { LiquidGlass } from '../LiquidGlass';
import { Mascot, inferMascotRole } from '../Mascot';

interface SeedEvent {
  id: string;
  from: string;
  verb: string;
  target: string;
  ago: string;
}

const SEED_EVENTS: SeedEvent[] = [
  {
    id: 'seed-1',
    from: 'Atlas Coder',
    verb: 'committed',
    target: 'feat(ui): glass kanban',
    ago: 'just now',
  },
  {
    id: 'seed-2',
    from: 'Vega Reviewer',
    verb: 'asked',
    target: 'about layout at 1280px',
    ago: '2m',
  },
  { id: 'seed-3', from: 'Aurora Lead', verb: 'finished', target: 'sprint planning', ago: '6m' },
  { id: 'seed-4', from: 'Lyra Designer', verb: 'shared', target: 'mascot palette', ago: '12m' },
];

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

// Right-rail activity stream. Tops out with a heartbeat EKG strip that
// blips whenever the message count grows. Each row is a small glass row
// with the from-mascot, a verb, the target, and a relative timestamp.
export const ActivityStream = (): React.JSX.Element => {
  const messages = useStore((s) => s.selectedTeamData?.messages ?? []);
  const events = useMemo(() => toEvents(messages), [messages]);
  const isSeeded = events.length === 0;
  const display = isSeeded ? SEED_EVENTS : events;
  const heartbeatCount = isSeeded ? 0 : events.length;

  return (
    <LiquidGlass radius={26} className="flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between px-1">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
          Activity
        </h3>
        <Heartbeat trigger={heartbeatCount} />
      </header>

      <ul className="flex flex-col gap-1.5">
        {display.map((event, idx) => (
          <motion.li
            key={event.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: isSeeded ? 0.78 : 1, y: 0 }}
            transition={{ duration: 0.4, ease: APPLE_EASE, delay: idx * 0.03 }}
          >
            <ActivityRow event={event} />
          </motion.li>
        ))}
      </ul>

      {isSeeded && (
        <p className="px-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-4)]">
          Sample events — real activity arrives once a team is live.
        </p>
      )}
    </LiquidGlass>
  );
};

const ActivityRow = ({ event }: { event: SeedEvent }): React.JSX.Element => {
  const role = inferMascotRole(event.from);
  return (
    <div
      className="flex items-start gap-3 rounded-[14px] border border-white/55 bg-white/55 px-3 py-2 transition-colors duration-200 hover:bg-white/70"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }}
    >
      <Mascot role={role} size={32} seed={event.from} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-[color:var(--ink-1)]">
          <span className="font-medium">{event.from}</span>{' '}
          <span className="text-[color:var(--ink-3)]">{event.verb}</span>{' '}
          <span className="text-[color:var(--ink-2)]">{event.target}</span>
        </p>
      </div>
      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[color:var(--ink-3)]">
        {event.ago}
      </span>
    </div>
  );
};

// Heartbeat — a 6-segment SVG EKG strip that does a single full sweep each
// time the parent reports a new event count. The base pulse runs slowly so
// the surface always feels alive, even at zero events.
const Heartbeat = ({ trigger }: { trigger: number }): React.JSX.Element => {
  const reduceMotion = useReducedMotion();
  const [, setKey] = useState(0);
  const lastTrigger = useRef(trigger);

  useEffect(() => {
    if (trigger !== lastTrigger.current) {
      lastTrigger.current = trigger;
      setKey((k) => k + 1);
    }
  }, [trigger]);

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-flex h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--ok)' }}
        aria-hidden="true"
      />
      <svg width="56" height="14" viewBox="0 0 56 14" aria-hidden="true">
        <motion.path
          d="M0 7 L10 7 L14 2 L18 12 L22 4 L28 7 L40 7 L44 4 L48 10 L56 7"
          fill="none"
          stroke="var(--ok)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={
            reduceMotion
              ? { pathLength: 1, opacity: 1 }
              : { pathLength: [0, 1, 1], opacity: [0.4, 1, 0.4] }
          }
          transition={
            reduceMotion ? undefined : { duration: 2.4, ease: 'easeInOut', repeat: Infinity }
          }
        />
      </svg>
    </div>
  );
};

function toEvents(messages: InboxMessage[]): SeedEvent[] {
  return messages
    .slice(-12)
    .reverse()
    .map((msg, i) => ({
      id: msg.messageId ?? `${msg.from}-${msg.timestamp}-${i}`,
      from: msg.from,
      verb: verbForMessage(msg),
      target: msg.summary ?? truncate(msg.text, 60),
      ago: relativeTime(msg.timestamp),
    }));
}

function verbForMessage(msg: InboxMessage): string {
  switch (msg.messageKind) {
    case 'slash_command':
      return 'ran';
    case 'slash_command_result':
      return 'returned';
    case 'task_comment_notification':
      return 'commented on';
    default:
      break;
  }
  if (msg.toolSummary) return 'used tools for';
  if (msg.source === 'cross_team' || msg.source === 'cross_team_sent') return 'pinged';
  return 'said';
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
