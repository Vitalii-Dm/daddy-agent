import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

import { scrollToAnchor } from '@renderer/lib/lenis';
import { useStore } from '@renderer/store';
import { isDemoTeamName } from '@renderer/utils/demoTeamFixture';
import type { TeamSummary } from '@shared/types/team';

import { LiquidGlass } from '../LiquidGlass';
import { LivePreviewStrip } from '../LivePreviewStrip';

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

// Hero — full viewport, displays the Instrument Serif headline and the
// two CTA buttons. The italic emphasis word ("agents") receives a brief
// rainbow-sheen sweep on mount via an SVG mask. Live preview strip lives
// in commit 7 and is mounted at the bottom of the section.
export const HeroSection = (): React.JSX.Element => {
  const reduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const allTeams = useStore((s) => s.teams);
  const teams = useMemo(() => allTeams.filter((t) => !t.deletedAt), [allTeams]);
  const selectTeam = useStore((s) => s.selectTeam);

  // Scroll-linked transforms — title scales down, body fades, preview strip
  // parallaxes upward as the hero leaves the viewport. All driven by the
  // section's own scroll progress so the math stays local.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const titleScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.92]);
  const titleY = useTransform(scrollYProgress, [0, 0.5], [0, -60]);
  const bodyOpacity = useTransform(scrollYProgress, [0, 0.45], [1, 0.2]);
  const stripY = useTransform(scrollYProgress, [0, 1], [0, -160]);

  return (
    <section
      ref={sectionRef}
      id="home"
      className="relative isolate flex min-h-screen flex-col px-6 pb-24 pt-32 sm:px-10 lg:px-16"
      style={{ scrollMarginTop: '88px' }}
    >
      <div className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col">
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: APPLE_EASE }}
          className="font-mono text-[12px] uppercase tracking-[0.32em] text-[color:var(--ink-3)]"
        >
          daddy.agent
        </motion.p>

        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 24, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.85, ease: APPLE_EASE, delay: 0.05 }}
          className="mt-8 font-serif font-normal text-[color:var(--ink-1)]"
          style={{
            fontSize: 'clamp(48px, 8.5vw, 144px)',
            lineHeight: 0.92,
            letterSpacing: '-0.04em',
            maxWidth: 'min(13ch, 100%)',
            scale: reduceMotion ? 1 : titleScale,
            y: reduceMotion ? 0 : titleY,
            transformOrigin: 'left top',
          }}
        >
          <span className="block">Orchestrate an</span>
          <span className="block">
            <SheenWord word="army" /> <span className="font-serif">of</span>
          </span>
          <span className="block">
            <SheenWord word="agents." delay={0.4} />
          </span>
        </motion.h1>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: APPLE_EASE, delay: 0.25 }}
          style={{ opacity: reduceMotion ? 1 : bodyOpacity }}
          className="mt-10 max-w-[560px] text-[18px] leading-[1.55] text-[color:var(--ink-2)]"
        >
          A CTO-shaped control surface for parallel Claude Code and Codex workers. Tmux beneath.
          Glass on top.
        </motion.p>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: APPLE_EASE, delay: 0.4 }}
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <PrimaryCta teams={teams} onSelectTeam={selectTeam} />
          <DemoTeamCta />
          <SecondaryCta />
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: APPLE_EASE, delay: 0.55 }}
          style={{ y: reduceMotion ? 0 : stripY }}
          className="mt-16 min-h-[180px] flex-1"
        >
          <LivePreviewStrip />
        </motion.div>

        <ScrollCaret />
      </div>
    </section>
  );
};

interface SheenWordProps {
  word: string;
  delay?: number;
}

// Italic serif word with a one-shot specular sheen. The sheen is a moving
// linear gradient clipped to the text via background-clip — works at every
// font size, no SVG sizing math required. Falls back to a flat italic for
// prefers-reduced-motion users.
const SheenWord = ({ word, delay = 0 }: SheenWordProps): React.JSX.Element => {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <em className="font-serif italic">{word}</em>;
  }

  return (
    <span className="relative inline-block align-baseline">
      <em className="font-serif italic">{word}</em>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 font-serif italic"
        style={{
          backgroundImage:
            'linear-gradient(115deg, transparent 30%, rgba(180,200,255,0.85) 45%, rgba(255,210,225,0.95) 50%, rgba(184,242,123,0.75) 55%, transparent 70%)',
          backgroundSize: '220% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          mixBlendMode: 'screen',
        }}
        initial={{ backgroundPositionX: '120%' }}
        animate={{ backgroundPositionX: '-120%' }}
        transition={{ duration: 1.2, ease: APPLE_EASE, delay: 0.6 + delay }}
      >
        {word}
      </motion.span>
    </span>
  );
};

interface PrimaryCtaProps {
  teams: TeamSummary[];
  onSelectTeam: (teamName: string) => Promise<void>;
}

const PrimaryCta = ({ teams, onSelectTeam }: PrimaryCtaProps): React.JSX.Element => {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const reduceMotion = useReducedMotion();

  // Dismiss picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent): void => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const handleClick = (): void => {
    if (teams.length === 0) {
      window.dispatchEvent(new CustomEvent('aurora:create-team'));
    } else {
      setShowPicker((v) => !v);
    }
  };

  const handleSelectTeam = (teamName: string): void => {
    setShowPicker(false);
    void onSelectTeam(teamName).then(() => {
      scrollToAnchor('#dashboard');
    });
  };

  const handleCreateNew = (): void => {
    setShowPicker(false);
    window.dispatchEvent(new CustomEvent('aurora:create-team'));
  };

  const label = teams.length > 0 ? 'Get started' : 'Create your first team';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className="group relative inline-flex h-12 items-center gap-2 overflow-hidden rounded-full px-6 text-[14px] font-medium text-white transition-transform duration-300 will-change-transform hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-base)]"
        style={{
          background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
          boxShadow:
            '0 14px 38px -14px rgba(124, 92, 255, 0.55), 0 4px 12px -4px rgba(61, 198, 255, 0.35), inset 0 1px 0 rgba(255,255,255,0.4)',
        }}
      >
        <span className="relative z-10">{label}</span>
        <span
          aria-hidden="true"
          className="relative z-10 text-white/80 transition-transform duration-300 group-hover:translate-x-[2px]"
        >
          →
        </span>
        <span
          aria-hidden="true"
          className="absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full"
          style={{
            background:
              'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)',
          }}
        />
      </button>

      <AnimatePresence>
        {showPicker && (
          <motion.div
            ref={pickerRef}
            initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="absolute left-0 top-full z-50 mt-2 w-72"
          >
            <LiquidGlass radius={20} shadow="lifted" className="flex flex-col overflow-hidden p-2">
              <p className="px-3 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--ink-3)]">
                Choose a team
              </p>

              <ul className="flex flex-col gap-1">
                {teams.map((team) => {
                  const isRunning = team.teamLaunchState === 'clean_success';
                  return (
                    <li key={team.teamName}>
                      <button
                        type="button"
                        onClick={() => handleSelectTeam(team.teamName)}
                        className="flex w-full items-center gap-3 rounded-[12px] border border-white/55 bg-white/55 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
                        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)' }}
                      >
                        <span
                          className="inline-flex h-2 w-2 shrink-0 rounded-full"
                          style={{ background: isRunning ? 'var(--ok)' : 'var(--ink-4)' }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[color:var(--ink-1)]">
                            {team.displayName || team.teamName}
                          </span>
                          <span className="block text-[11px] text-[color:var(--ink-3)]">
                            {team.memberCount} {team.memberCount === 1 ? 'agent' : 'agents'}
                            {isRunning ? ' · live' : ''}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-[color:var(--ink-3)] transition-transform duration-200 group-hover:translate-x-0.5"
                        >
                          →
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-1.5 border-t border-[color:var(--glass-shade)] pt-1.5">
                <button
                  type="button"
                  onClick={handleCreateNew}
                  className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-medium text-[color:var(--ink-2)] transition-colors hover:bg-white/50 hover:text-[color:var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)]"
                >
                  <span className="text-[16px] leading-none">+</span>
                  <span>Create new team</span>
                </button>
              </div>
            </LiquidGlass>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DemoTeamCta = (): React.JSX.Element | null => {
  const seedDemoTeam = useStore((s) => s.seedDemoTeam);
  const selectedTeamName = useStore((s) => s.selectedTeamName);
  if (isDemoTeamName(selectedTeamName)) return null;
  return (
    <LiquidGlass
      as="button"
      radius={999}
      refract={false}
      onClick={() => {
        seedDemoTeam();
        scrollToAnchor('#dashboard');
      }}
      className="inline-flex h-12 items-center gap-2 px-5 text-[13px] font-medium text-[color:var(--ink-1)] transition-transform duration-300 hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--a-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-base)]"
    >
      <span aria-hidden="true">✨</span>
      <span>Try demo team</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
        no auth
      </span>
    </LiquidGlass>
  );
};

const SecondaryCta = (): React.JSX.Element => (
  <LiquidGlass
    as="button"
    radius={999}
    refract={false}
    onClick={() => window.dispatchEvent(new CustomEvent('aurora:open-command-bar'))}
    className="inline-flex h-12 items-center gap-2.5 px-5 text-[13px] font-medium text-[color:var(--ink-1)] transition-transform duration-300 hover:-translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ink-2)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-base)]"
  >
    <kbd className="inline-flex h-6 items-center rounded-md border border-[color:var(--glass-shade)] bg-white/60 px-1.5 font-mono text-[11px] text-[color:var(--ink-2)] shadow-[inset_0_-1px_0_rgba(20,19,26,0.06)]">
      ⌘K
    </kbd>
    <span>Open the command bar</span>
  </LiquidGlass>
);

const ScrollCaret = (): React.JSX.Element => {
  const reduceMotion = useReducedMotion();
  return (
    <a
      href="#dashboard"
      onClick={(e) => {
        e.preventDefault();
        scrollToAnchor('#dashboard');
      }}
      className="mt-10 inline-flex items-center gap-2 self-start font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-3)] transition-colors hover:text-[color:var(--ink-1)]"
    >
      <span>Scroll to open</span>
      <motion.svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        animate={reduceMotion ? undefined : { y: [0, 4, 0] }}
        transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity }}
        aria-hidden="true"
      >
        <path
          d="M3 5l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </motion.svg>
    </a>
  );
};
