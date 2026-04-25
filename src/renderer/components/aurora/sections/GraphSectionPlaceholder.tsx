import React from 'react';
import { motion } from 'motion/react';

import { LiquidGlass } from '../LiquidGlass';

// VITE_GRAPH=on opens the placeholder card; default keeps the slot collapsed
// so the dashboard remains the bottom section. The container reserves the
// `#graph` anchor either way so the command bar's "Open the knowledge graph"
// item lands somewhere meaningful.
const GRAPH_VISIBLE = (import.meta.env.VITE_GRAPH ?? 'on') === 'on';

const APPLE_EASE = [0.22, 1, 0.36, 1] as const;

export const GraphSectionPlaceholder = (): React.JSX.Element => {
  if (!GRAPH_VISIBLE) {
    return <section id="graph" aria-hidden="true" className="h-0 overflow-hidden" />;
  }

  return (
    <section
      id="graph"
      className="relative px-6 pb-32 pt-12 sm:px-10 lg:px-16"
      style={{ scrollMarginTop: '88px' }}
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.65, ease: APPLE_EASE }}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[color:var(--ink-3)]">
            Reserved
          </p>
          <h2
            className="mt-3 font-serif font-normal text-[color:var(--ink-1)]"
            style={{
              fontSize: 'clamp(36px, 4vw, 56px)',
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
            }}
          >
            Knowledge graph — <em className="italic">coming soon.</em>
          </h2>
          <p className="mt-2 max-w-[560px] text-[14px] text-[color:var(--ink-2)]">
            Future home for the agent-graph view. Drop in
            <code className="mx-1 rounded bg-white/55 px-1 font-mono text-[12px] text-[color:var(--ink-1)]">
              packages/agent-graph
            </code>
            and remove the veil.
          </p>

          <LiquidGlass
            refract
            radius={28}
            shadow="lifted"
            className="relative mt-10 flex h-[420px] w-full items-center justify-center overflow-hidden"
          >
            {/* Fake graph nodes — pure visual flair so the card feels alive */}
            <svg
              viewBox="0 0 1200 420"
              className="absolute inset-0 h-full w-full opacity-65"
              aria-hidden="true"
            >
              <defs>
                <radialGradient id="graph-node-violet" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--a-violet)" />
                  <stop offset="100%" stopColor="var(--a-violet)" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="graph-node-cyan" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--a-cyan)" />
                  <stop offset="100%" stopColor="var(--a-cyan)" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="graph-node-peach" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--a-peach)" />
                  <stop offset="100%" stopColor="var(--a-peach)" stopOpacity="0" />
                </radialGradient>
              </defs>
              {[
                [180, 220, 90, 'graph-node-violet'],
                [600, 110, 70, 'graph-node-cyan'],
                [820, 280, 80, 'graph-node-peach'],
                [380, 320, 60, 'graph-node-cyan'],
                [1020, 150, 75, 'graph-node-violet'],
              ].map((n, i) => (
                <circle
                  key={i}
                  cx={n[0] as number}
                  cy={n[1] as number}
                  r={n[2] as number}
                  fill={`url(#${n[3]})`}
                />
              ))}
              {[
                [180, 220, 600, 110],
                [600, 110, 820, 280],
                [820, 280, 380, 320],
                [600, 110, 1020, 150],
                [180, 220, 380, 320],
              ].map((p, i) => (
                <line
                  key={i}
                  x1={p[0]}
                  y1={p[1]}
                  x2={p[2]}
                  y2={p[3]}
                  stroke="rgba(20,19,26,0.18)"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                />
              ))}
            </svg>

            {/* Veil — frosts the preview so the "coming soon" copy reads first */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0.65))',
                backdropFilter: 'blur(6px)',
              }}
              aria-hidden="true"
            />

            <p className="relative z-10 max-w-[420px] text-center font-serif text-[24px] italic text-[color:var(--ink-2)]">
              Knowledge graph — coming soon.
            </p>
          </LiquidGlass>
        </motion.div>
      </div>
    </section>
  );
};
