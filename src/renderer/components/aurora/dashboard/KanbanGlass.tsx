import React from 'react';

import { LiquidGlass } from '../LiquidGlass';

interface KanbanGlassProps {
  filter: string;
  view: string;
}

// Stub — fleshed out in commit 10.
export const KanbanGlass = ({ filter, view }: KanbanGlassProps): React.JSX.Element => (
  <LiquidGlass radius={24} className="flex h-[520px] items-center justify-center p-5 text-center">
    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
      Kanban — {view} · {filter}
    </p>
  </LiquidGlass>
);
