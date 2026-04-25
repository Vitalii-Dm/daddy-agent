import React from 'react';
import { motion } from 'motion/react';

import { LiquidGlass } from '../LiquidGlass';
import { KnowledgeGraphView } from './KnowledgeGraphView';

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
            Knowledge graph
          </h2>
          <p className="mt-2 max-w-[560px] text-[14px] text-[color:var(--ink-2)]">
            Live view of the Neo4j codebase graph. Nodes are coloured by community; the summary view
            culls stdlib hubs (typing, pathlib, …) so the structure stays readable.
          </p>

          <LiquidGlass
            refract
            radius={28}
            shadow="lifted"
            className="relative mt-10 flex h-[420px] w-full items-center justify-center overflow-hidden"
          >
            <KnowledgeGraphView />
          </LiquidGlass>
        </motion.div>
      </div>
    </section>
  );
};
