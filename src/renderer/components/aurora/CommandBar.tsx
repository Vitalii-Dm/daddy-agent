import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Command } from 'cmdk';

import { scrollToAnchor } from '@renderer/lib/lenis';
import { useStore } from '@renderer/store';
import { isDemoTeamName } from '@renderer/utils/demoTeamFixture';

import { LiquidGlass } from './LiquidGlass';
import { Mascot, inferMascotRole } from './Mascot';
import { useAuroraTeam } from './hooks/useAuroraTeam';

type CommandGroup = 'Navigate' | 'Teams' | 'Tasks' | 'View' | 'Agents' | 'System';

interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  group: CommandGroup;
  perform: () => void;
}

const FILTER_LABELS = ['All', 'In progress', 'Review', 'Blocked'] as const;
const VIEW_LABELS = ['Kanban', 'List', 'Graph'] as const;

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

// ⌘K command bar. Always visible at bottom-center once the user has scrolled
// past the hero. Click or hotkey to open the full command palette overlay.
export const CommandBar = (): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [showPill, setShowPill] = useState(false);
  const reduceMotion = useReducedMotion();
  const { members, teamName } = useAuroraTeam();
  const seedDemoTeam = useStore((s) => s.seedDemoTeam);
  const seedGeminiDemoTeam = useStore((s) => s.seedGeminiDemoTeam);
  const isDemoActive = isDemoTeamName(teamName);

  // Hotkey + custom-event open trigger (used by the hero secondary CTA)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onOpenEvent = (): void => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('aurora:open-command-bar', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('aurora:open-command-bar', onOpenEvent);
    };
  }, [open]);

  // Visible only after scrolling past the hero
  useEffect(() => {
    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setShowPill(window.scrollY > window.innerHeight * 0.6));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const navigate = useCallback((anchor: string) => {
    setOpen(false);
    scrollToAnchor(anchor);
  }, []);

  const dispatchAndClose = useCallback((event: Event) => {
    setOpen(false);
    window.dispatchEvent(event);
  }, []);

  const actions = useMemo<CommandAction[]>(() => {
    const list: CommandAction[] = [
      {
        id: 'go-home',
        label: 'Go to home',
        group: 'Navigate',
        hint: '#home',
        perform: () => navigate('#home'),
      },
      {
        id: 'go-dashboard',
        label: 'Open the dashboard',
        group: 'Navigate',
        hint: '#dashboard',
        perform: () => navigate('#dashboard'),
      },
      {
        id: 'go-graph',
        label: 'Open the knowledge graph',
        group: 'Navigate',
        hint: '#graph',
        perform: () => navigate('#graph'),
      },
      {
        id: 'team-create',
        label: 'Create new team',
        group: 'Teams',
        perform: () => dispatchAndClose(new CustomEvent('aurora:create-team')),
      },
    ];

    if (teamName) {
      list.push({
        id: 'team-launch',
        label: 'Launch team',
        group: 'Teams',
        hint: teamName,
        perform: () => dispatchAndClose(new CustomEvent('aurora:launch-team')),
      });
    }

    if (!isDemoActive) {
      list.push({
        id: 'team-demo',
        label: 'Try demo team',
        group: 'Teams',
        hint: 'no auth needed',
        perform: () => {
          setOpen(false);
          seedDemoTeam();
          scrollToAnchor('#dashboard');
        },
      });
      list.push({
        id: 'team-demo-gemini',
        label: 'Try Gemini demo team',
        group: 'Teams',
        hint: 'gemini-cli',
        perform: () => {
          setOpen(false);
          seedGeminiDemoTeam();
          scrollToAnchor('#dashboard');
        },
      });
    }

    list.push({
      id: 'task-create',
      label: 'Create new task',
      group: 'Tasks',
      hint: teamName ?? 'no team',
      perform: () => dispatchAndClose(new CustomEvent('aurora:create-task')),
    });

    if (teamName) {
      list.push({
        id: 'task-trash',
        label: 'Open trash',
        group: 'Tasks',
        perform: () => dispatchAndClose(new CustomEvent('aurora:open-trash')),
      });
    }

    for (const filter of FILTER_LABELS) {
      list.push({
        id: `filter-${filter}`,
        label: `Filter · ${filter}`,
        group: 'Tasks',
        perform: () => dispatchAndClose(new CustomEvent('aurora:set-filter', { detail: filter })),
      });
    }

    for (const view of VIEW_LABELS) {
      list.push({
        id: `view-${view}`,
        label: `Switch view · ${view}`,
        group: 'View',
        perform: () => dispatchAndClose(new CustomEvent('aurora:set-view', { detail: view })),
      });
    }

    if (teamName) {
      list.push({
        id: 'open-full-chat',
        label: 'Open full chat',
        group: 'Agents',
        hint: 'fullscreen',
        perform: () =>
          dispatchAndClose(
            new CustomEvent('aurora:open-chat', {
              detail: { recipient: members[0]?.name ?? 'lead', fullscreen: true },
            })
          ),
      });
    }

    if (members.length === 0) {
      list.push({
        id: 'message-fallback',
        label: 'Open chat',
        group: 'Agents',
        hint: teamName ?? 'no team',
        perform: () =>
          dispatchAndClose(new CustomEvent('aurora:open-chat', { detail: { recipient: 'lead' } })),
      });
    } else {
      for (const member of members) {
        list.push({
          id: `message-${member.name}`,
          label: `Message ${member.name}`,
          group: 'Agents',
          hint: member.role ?? member.agentType,
          perform: () =>
            dispatchAndClose(
              new CustomEvent('aurora:open-chat', { detail: { recipient: member.name } })
            ),
        });
      }
    }

    list.push({
      id: 'show-insights',
      label: 'Show context insights',
      group: 'System',
      perform: () => dispatchAndClose(new CustomEvent('aurora:open-insights')),
    });
    list.push({
      id: 'toggle-theme',
      label: 'Toggle theme',
      group: 'System',
      perform: toggleTheme,
    });

    return list;
  }, [
    navigate,
    dispatchAndClose,
    teamName,
    isDemoActive,
    seedDemoTeam,
    seedGeminiDemoTeam,
    members,
  ]);

  const recentMascots = members.slice(0, 3);

  return (
    <>
      <AnimatePresence>
        {showPill && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.32, ease: APPLE_EASE }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
          >
            <LiquidGlass
              as="button"
              refract
              radius={999}
              shadow="lifted"
              onClick={() => setOpen(true)}
              className="pointer-events-auto flex h-14 w-full max-w-[560px] items-center gap-3 px-4 text-left transition-transform duration-300 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-base)]"
            >
              <div className="flex shrink-0 -space-x-2">
                {(recentMascots.length === 0 ? FALLBACK_MASCOTS : recentMascots).map((m) => (
                  <span
                    key={m.name}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-white/85"
                  >
                    <Mascot role={inferMascotRole(m.role ?? m.name)} size={32} seed={m.name} />
                  </span>
                ))}
              </div>
              <span className="flex-1 truncate text-[13px] text-[color:var(--ink-2)]">
                Search agents, tasks, or run a command…
              </span>
              <kbd className="inline-flex h-6 items-center rounded-md border border-[color:var(--glass-shade)] bg-white/60 px-1.5 font-mono text-[11px] text-[color:var(--ink-2)]">
                ⌘K
              </kbd>
            </LiquidGlass>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh]"
            onClick={() => setOpen(false)}
          >
            <div
              className="absolute inset-0"
              style={{
                background: 'rgba(20, 19, 26, 0.18)',
                backdropFilter: 'blur(8px)',
              }}
              aria-hidden="true"
            />
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: -16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.32, ease: APPLE_EASE }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[640px]"
            >
              <LiquidGlass refract radius={20} shadow="lifted" className="overflow-hidden">
                <Command
                  label="Aurora command palette"
                  className="flex flex-col"
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Escape') setOpen(false);
                  }}
                >
                  <div className="flex items-center gap-3 border-b border-[color:var(--glass-shade)] px-4 py-3">
                    <SearchGlyph />
                    <Command.Input
                      autoFocus
                      placeholder="Search agents, tasks, or run a command…"
                      className="h-9 flex-1 bg-transparent text-[14px] text-[color:var(--ink-1)] placeholder:text-[color:var(--ink-3)] focus:outline-none"
                    />
                    <kbd className="inline-flex h-6 items-center rounded-md border border-[color:var(--glass-shade)] bg-white/55 px-1.5 font-mono text-[11px] text-[color:var(--ink-2)]">
                      esc
                    </kbd>
                  </div>

                  <Command.List className="max-h-[420px] overflow-y-auto px-2 py-3">
                    <Command.Empty className="px-4 py-8 text-center text-[13px] text-[color:var(--ink-3)]">
                      Nothing matches yet — try a different word.
                    </Command.Empty>

                    {(['Navigate', 'Teams', 'Tasks', 'View', 'Agents', 'System'] as const).map(
                      (group) => (
                        <Command.Group
                          key={group}
                          heading={group}
                          className="px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-[color:var(--ink-3)]"
                        >
                          {actions
                            .filter((a) => a.group === group)
                            .map((action) => (
                              <Command.Item
                                key={action.id}
                                value={`${action.label} ${action.hint ?? ''}`}
                                onSelect={() => action.perform()}
                                className="flex cursor-pointer items-center justify-between rounded-[10px] px-3 py-2 text-[13px] text-[color:var(--ink-1)] aria-selected:bg-white/70 aria-selected:shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                              >
                                <span>{action.label}</span>
                                {action.hint && (
                                  <span className="font-mono text-[11px] text-[color:var(--ink-3)]">
                                    {action.hint}
                                  </span>
                                )}
                              </Command.Item>
                            ))}
                        </Command.Group>
                      )
                    )}
                  </Command.List>
                </Command>
              </LiquidGlass>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

const FALLBACK_MASCOTS = [
  { name: 'Lead', role: 'lead' },
  { name: 'Coder', role: 'coder' },
  { name: 'Reviewer', role: 'reviewer' },
];

const SearchGlyph = (): React.JSX.Element => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className="shrink-0 text-[color:var(--ink-3)]"
  >
    <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.dataset.theme === 'aurora' ? 'classic' : 'aurora';
  root.dataset.theme = next;
}
