import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { KGEdge, KGGraphResponse, KGHealth, KGNode } from '@shared/types';

// ---------------------------------------------------------------------------
// Self-contained graph view that drops into the Aurora `KnowledgeGraph` slot.
// Talks to the Electron main process via window.api.knowledgeGraph; the main
// process owns the Python sidecar lifecycle and proxies HTTP. We never speak
// HTTP from the renderer directly.
//
// Rendering is plain SVG with a deterministic radial-by-community layout —
// good for the summary view's ~100 nodes. Heavier viz (sigma + ForceAtlas2)
// can swap in later without changing the data wiring.
// ---------------------------------------------------------------------------

type ViewState =
  | { kind: 'idle' }
  | { kind: 'starting'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'ready'; data: KGGraphResponse }
  | { kind: 'error'; message: string; canRetry: boolean };

const PALETTE = [
  '#7c3aed', // violet
  '#0ea5e9', // sky
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#ec4899', // pink
  '#14b8a6', // teal
  '#8b5cf6', // purple
  '#f97316', // orange
  '#22c55e', // green
];

const DEFAULT_COLOR = '#64748b'; // slate

const FALLBACK_COMMUNITY = '__none__';

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  community: string;
}

function colorForCommunity(community: string, communities: string[]): string {
  if (community === FALLBACK_COMMUNITY) return DEFAULT_COLOR;
  const idx = communities.indexOf(community);
  return PALETTE[idx % PALETTE.length] ?? DEFAULT_COLOR;
}

/**
 * Group nodes by `community` (falling back to `type`). Lay out groups around a
 * big circle, then place each group's nodes around a smaller inner circle.
 * Deterministic: same input always produces the same layout.
 */
function layout(
  nodes: KGNode[],
  width: number,
  height: number
): { nodes: LayoutNode[]; communities: string[]; idIndex: Map<string, LayoutNode> } {
  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(width, height) * 0.38;

  const groups = new Map<string, KGNode[]>();
  for (const n of nodes) {
    const key = n.community ?? n.type ?? FALLBACK_COMMUNITY;
    const arr = groups.get(key) ?? [];
    arr.push(n);
    groups.set(key, arr);
  }

  const communities = Array.from(groups.keys()).sort((a, b) => {
    const sa = groups.get(a)?.length ?? 0;
    const sb = groups.get(b)?.length ?? 0;
    return sb - sa;
  });

  const laid: LayoutNode[] = [];
  const idIndex = new Map<string, LayoutNode>();
  const groupCount = Math.max(communities.length, 1);

  communities.forEach((community, gi) => {
    const groupAngle = (gi / groupCount) * Math.PI * 2;
    const gx = cx + Math.cos(groupAngle) * outerR;
    const gy = cy + Math.sin(groupAngle) * outerR;
    const members = groups.get(community) ?? [];
    const innerR = Math.min(60, 18 + Math.sqrt(members.length) * 14);
    const color = colorForCommunity(community, communities);

    members.forEach((node, ni) => {
      const angle = (ni / Math.max(members.length, 1)) * Math.PI * 2;
      const x = gx + Math.cos(angle) * innerR;
      const y = gy + Math.sin(angle) * innerR;
      const size = Math.max(3, Math.min(node.size, 14));
      const ln: LayoutNode = {
        id: node.id,
        x,
        y,
        size,
        color,
        label: node.label,
        community,
      };
      laid.push(ln);
      idIndex.set(node.id, ln);
    });
  });

  return { nodes: laid, communities, idIndex };
}

function countLabel(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : plural ?? `${singular}s`}`;
}

export const KnowledgeGraphView = (): React.JSX.Element => {
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 420 });

  // -- Bring up the sidecar + first query.
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.knowledgeGraph;
    if (!api) {
      setState({
        kind: 'error',
        message: 'Knowledge graph API not available in this build.',
        canRetry: false,
      });
      return;
    }

    const run = async (): Promise<void> => {
      try {
        setState({ kind: 'starting', message: 'Starting knowledge graph service…' });
        const health: KGHealth = await api.start();
        if (cancelled) return;
        if (health.serverStatus !== 'running') {
          setState({
            kind: 'error',
            message:
              health.lastError ??
              `Sidecar failed to start (status: ${health.serverStatus}).`,
            canRetry: true,
          });
          return;
        }
        if (health.neo4jStatus === 'unreachable') {
          setState({
            kind: 'error',
            message:
              'Neo4j is not reachable. Run `docker compose up -d neo4j` and retry.',
            canRetry: true,
          });
          return;
        }
        setState({ kind: 'loading', message: 'Loading graph…' });
        const data = await api.query({ db: 'codebase', view: 'summary' });
        if (cancelled) return;
        setState({ kind: 'ready', data });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message, canRetry: true });
      }
    };

    void run();
    return (): void => {
      cancelled = true;
    };
  }, []);

  // -- Track container size for responsive SVG.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ w: Math.max(400, width), h: Math.max(200, height) });
      }
    });
    observer.observe(el);
    return (): void => observer.disconnect();
  }, []);

  // -- Compute layout (memoized so resize doesn't reshuffle indexing only).
  const layoutResult = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return layout(state.data.nodes, size.w, size.h);
  }, [state, size.w, size.h]);

  // -- Edge lookup against laid-out nodes.
  const drawnEdges = useMemo(() => {
    if (!layoutResult || state.kind !== 'ready') return [];
    const { idIndex } = layoutResult;
    const result: { id: string; x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
    for (const edge of state.data.edges as KGEdge[]) {
      const a = idIndex.get(edge.source);
      const b = idIndex.get(edge.target);
      if (!a || !b) continue;
      result.push({
        id: edge.id,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: a.color,
      });
    }
    return result;
  }, [layoutResult, state]);

  const handleRetry = (): void => {
    setState({ kind: 'idle' });
    // Re-trigger the start/query effect by remounting via a key bump.
    // Simpler: just call the same flow inline.
    const api = window.electronAPI?.knowledgeGraph;
    if (!api) return;
    void (async () => {
      setState({ kind: 'starting', message: 'Restarting…' });
      try {
        const h = await api.start();
        if (h.serverStatus !== 'running' || h.neo4jStatus === 'unreachable') {
          setState({
            kind: 'error',
            message: h.lastError ?? 'Service not ready.',
            canRetry: true,
          });
          return;
        }
        setState({ kind: 'loading', message: 'Loading graph…' });
        const data = await api.query({ db: 'codebase', view: 'summary' });
        setState({ kind: 'ready', data });
      } catch (err) {
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          canRetry: true,
        });
      }
    })();
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {state.kind === 'ready' && layoutResult ? (
        <>
          <svg
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full"
            aria-label="Neo4j knowledge graph"
          >
            <g opacity="0.35" stroke="currentColor" strokeWidth="0.6">
              {drawnEdges.map((e) => (
                <line
                  key={e.id}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke={e.color}
                  opacity={0.45}
                />
              ))}
            </g>
            <g>
              {layoutResult.nodes.map((n) => (
                <circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={n.size}
                  fill={n.color}
                  fillOpacity={hovered && hovered !== n.id ? 0.35 : 0.9}
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth={hovered === n.id ? 2 : 0.5}
                  onMouseEnter={(): void => setHovered(n.id)}
                  onMouseLeave={(): void => setHovered(null)}
                  style={{ cursor: 'pointer', transition: 'fill-opacity 120ms ease' }}
                >
                  <title>{n.label}</title>
                </circle>
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/55 px-2 py-1 font-mono text-[11px] text-[color:var(--ink-2)]">
            {countLabel(state.data.nodes.length, 'node')} ·{' '}
            {countLabel(state.data.edges.length, 'edge')}
            {state.data.hidden_hubs ? ` · ${state.data.hidden_hubs} hubs hidden` : ''}
          </div>
          {hovered && layoutResult.idIndex.get(hovered) ? (
            <div className="pointer-events-none absolute right-3 top-3 max-w-[280px] rounded bg-white/75 px-3 py-2 font-mono text-[11px] text-[color:var(--ink-1)] shadow">
              {layoutResult.idIndex.get(hovered)!.label}
            </div>
          ) : null}
        </>
      ) : state.kind === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="font-serif text-[18px] text-[color:var(--ink-1)]">
            Couldn&apos;t load the knowledge graph.
          </p>
          <p className="max-w-[480px] text-[13px] text-[color:var(--ink-2)]">{state.message}</p>
          {state.canRetry ? (
            <button
              type="button"
              onClick={handleRetry}
              className="mt-2 rounded-full bg-[color:var(--ink-1)] px-4 py-1.5 text-[12px] text-white hover:opacity-90"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div
            aria-hidden="true"
            className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--ink-3)] border-t-transparent"
          />
          <p className="font-serif text-[14px] italic text-[color:var(--ink-2)]">
            {state.kind === 'starting' || state.kind === 'loading'
              ? state.message
              : 'Waking up the graph…'}
          </p>
        </div>
      )}
    </div>
  );
};
