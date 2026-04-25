import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useStore } from '@renderer/store';

import type { KGDatabase, KGEdge, KGGraphResponse, KGHealth, KGNode, KGView } from '@shared/types';

// ---------------------------------------------------------------------------
// Self-contained graph view that drops into the Aurora `KnowledgeGraph` slot.
// Talks to the Electron main process via window.electronAPI.knowledgeGraph;
// the main process owns the Python sidecar lifecycle and proxies HTTP. We
// never speak HTTP from the renderer directly.
//
// Rendering is plain SVG with a deterministic radial-by-community layout +
// an SVG transform group for pan/zoom. Good for the summary view's ~100
// nodes; sigma + ForceAtlas2 can swap in later without touching the data
// wiring.
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
const DEFAULT_COLOR = '#64748b';
const FALLBACK_COMMUNITY = '__none__';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  size: number;
  degree: number;
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
 * Mulberry32 — tiny deterministic PRNG so layout is stable across renders.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return (): number => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Force-directed layout (Fruchterman-Reingold variant) seeded by community.
 * Nodes start in jittered community blobs so connected components find each
 * other quickly; iterations of repulsion + spring attraction settle the
 * graph. Deterministic — same input always produces the same positions.
 *
 * `seed` lets callers preserve positions across re-layouts (used when new
 * nodes are spliced in via neighbor expansion). Nodes already in the seed
 * keep their position; nodes missing from it start near `anchorId` (or in
 * a community blob if anchorId is unknown).
 */
function layout(
  nodes: KGNode[],
  edges: KGEdge[],
  width: number,
  height: number,
  options: {
    seed?: Map<string, { x: number; y: number }>;
    anchorId?: string;
    iterations?: number;
  } = {}
): { nodes: LayoutNode[]; communities: string[]; idIndex: Map<string, LayoutNode> } {
  const { seed, anchorId } = options;
  const cx = width / 2;
  const cy = height / 2;
  // Smaller seed radius keeps community blobs starting closer to the centre
  // — combined with the stronger center pull below this prevents clusters
  // from drifting too far apart.
  const seedR = Math.min(width, height) * 0.1;
  const rng = mulberry32(nodes.length * 7919 + edges.length);

  // Deterministic community ordering.
  const groups = new Map<string, KGNode[]>();
  for (const n of nodes) {
    const key = n.community ?? n.type ?? FALLBACK_COMMUNITY;
    const arr = groups.get(key) ?? [];
    arr.push(n);
    groups.set(key, arr);
  }
  const communities = Array.from(groups.keys()).sort((a, b) => {
    return (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0);
  });

  // Seed each community as a jittered blob inside the canvas.
  const groupCount = Math.max(communities.length, 1);
  const seedX: number[] = [];
  const seedY: number[] = [];
  const groupOf = new Map<string, number>();
  communities.forEach((c, gi) => {
    groupOf.set(c, gi);
    const angle = (gi / groupCount) * Math.PI * 2;
    seedX.push(cx + Math.cos(angle) * seedR);
    seedY.push(cy + Math.sin(angle) * seedR);
  });

  const anchorPos = anchorId && seed ? seed.get(anchorId) : undefined;

  const px = new Float64Array(nodes.length);
  const py = new Float64Array(nodes.length);
  const isFresh = new Array<boolean>(nodes.length).fill(false);
  const indexById = new Map<string, number>();
  nodes.forEach((node, i) => {
    indexById.set(node.id, i);
    const seedPos = seed?.get(node.id);
    if (seedPos) {
      px[i] = seedPos.x;
      py[i] = seedPos.y;
      return;
    }
    isFresh[i] = true;
    if (anchorPos) {
      // New node added via expansion — drop it close to the anchor with a
      // tight ring offset, force layout will refine.
      const r = 24 + rng() * 16;
      const a = rng() * Math.PI * 2;
      px[i] = anchorPos.x + Math.cos(a) * r;
      py[i] = anchorPos.y + Math.sin(a) * r;
      return;
    }
    const community = node.community ?? node.type ?? FALLBACK_COMMUNITY;
    const gi = groupOf.get(community) ?? 0;
    const jitter = 24;
    px[i] = seedX[gi] + (rng() - 0.5) * jitter;
    py[i] = seedY[gi] + (rng() - 0.5) * jitter;
  });

  // Edge index pairs (skip dangling edges).
  const ei: number[] = [];
  const ej: number[] = [];
  for (const edge of edges) {
    const a = indexById.get(edge.source);
    const b = indexById.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    ei.push(a);
    ej.push(b);
  }

  // Fruchterman-Reingold parameters. Note we deliberately do NOT hard-clamp
  // node positions during simulation — that produces the wall-hugging row
  // along the canvas edges. Instead we let nodes settle freely under
  // repulsion + spring + a gentle center pull, and fit the result into the
  // viewport in a post-processing step.
  const padding = 24;
  const xMin = padding;
  const yMin = padding;
  const xMax = width - padding;
  const yMax = height - padding;
  const area = (xMax - xMin) * (yMax - yMin);
  const k = Math.sqrt(area / Math.max(nodes.length, 1)) * 0.85;
  // Re-layouts (incremental seed) cool faster so existing structure isn't
  // shaken apart; cold-start gets the full 140 iterations.
  const iterations = options.iterations ?? (seed ? 60 : 140);
  let temperature = Math.min(width, height) * (seed ? 0.08 : 0.18);
  const cooling = temperature / (iterations + 1);

  const dx = new Float64Array(nodes.length);
  const dy = new Float64Array(nodes.length);

  for (let iter = 0; iter < iterations; iter++) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion (every pair).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const ddx = px[i] - px[j];
        const ddy = py[i] - py[j];
        let dist = Math.hypot(ddx, ddy);
        if (dist < 0.01) {
          dist = 0.01 + rng() * 0.5;
        }
        const force = (k * k) / dist;
        const fx = (ddx / dist) * force;
        const fy = (ddy / dist) * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }

    // Spring attraction along edges.
    for (let m = 0; m < ei.length; m++) {
      const i = ei[m];
      const j = ej[m];
      const ddx = px[i] - px[j];
      const ddy = py[i] - py[j];
      const dist = Math.max(0.01, Math.hypot(ddx, ddy));
      const force = (dist * dist) / k;
      const fx = (ddx / dist) * force;
      const fy = (ddy / dist) * force;
      dx[i] -= fx;
      dy[i] -= fy;
      dx[j] += fx;
      dy[j] += fy;
    }

    // Pull toward the canvas center. Stronger than a typical FR run since
    // we no longer have wall clamps as a backstop — and it disproportion-
    // ately compresses the gap *between* clusters (their centres are far
    // from the middle) without crushing the spacing *within* each cluster.
    const centerPull = 0.05;
    for (let i = 0; i < nodes.length; i++) {
      dx[i] += (cx - px[i]) * centerPull;
      dy[i] += (cy - py[i]) * centerPull;
    }

    // Apply, capped by current temperature. No wall clamp — the post-pass
    // below fits the final bounding box into the viewport so nothing
    // escapes off-canvas, and there's no boundary for nodes to stack on.
    for (let i = 0; i < nodes.length; i++) {
      const disp = Math.hypot(dx[i], dy[i]);
      if (disp > 0) {
        const limit = Math.min(disp, temperature);
        px[i] += (dx[i] / disp) * limit;
        py[i] += (dy[i] / disp) * limit;
      }
    }

    temperature = Math.max(0.5, temperature - cooling);
  }

  // Post-pass: fit the simulation output into the viewport — but never so
  // aggressively that edges become invisible because nodes are packed
  // shoulder-to-shoulder. We compute the auto-fit scale, then a "minimum
  // density" scale that keeps the average connected-node distance at least
  // MIN_AVG_EDGE_PX. The larger of the two wins; if that means the graph
  // overflows the viewport, that's expected — pan/zoom is right there.
  // Skip on incremental seeded re-layouts so the user's pan isn't disturbed.
  if (!seed && nodes.length > 0) {
    let minX = px[0];
    let maxX = px[0];
    let minY = py[0];
    let maxY = py[0];
    for (let i = 1; i < nodes.length; i++) {
      if (px[i] < minX) minX = px[i];
      if (px[i] > maxX) maxX = px[i];
      if (py[i] < minY) minY = py[i];
      if (py[i] > maxY) maxY = py[i];
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const targetW = xMax - xMin;
    const targetH = yMax - yMin;
    const fitScale = Math.min(targetW / bboxW, targetH / bboxH) * 0.92;

    // Density floor: average edge length must stay ≥ MIN_AVG_EDGE_PX.
    const MIN_AVG_EDGE_PX = 32;
    let avgEdge = 0;
    let edgeCount = 0;
    for (let m = 0; m < ei.length; m++) {
      avgEdge += Math.hypot(px[ei[m]] - px[ej[m]], py[ei[m]] - py[ej[m]]);
      edgeCount++;
    }
    if (edgeCount > 0) avgEdge /= edgeCount;
    const densityScale = avgEdge > 0 ? MIN_AVG_EDGE_PX / avgEdge : fitScale;
    const scale = Math.max(fitScale, densityScale);

    const bboxCx = (minX + maxX) / 2;
    const bboxCy = (minY + maxY) / 2;
    for (let i = 0; i < nodes.length; i++) {
      px[i] = cx + (px[i] - bboxCx) * scale;
      py[i] = cy + (py[i] - bboxCy) * scale;
    }
  }

  const laid: LayoutNode[] = [];
  const idIndex = new Map<string, LayoutNode>();
  nodes.forEach((node, i) => {
    const community = node.community ?? node.type ?? FALLBACK_COMMUNITY;
    const ln: LayoutNode = {
      id: node.id,
      x: px[i],
      y: py[i],
      size: Math.max(3, Math.min(node.size ?? 4, 14)),
      degree: node.degree ?? 0,
      color: colorForCommunity(community, communities),
      label: node.label,
      community,
    };
    laid.push(ln);
    idIndex.set(node.id, ln);
  });

  return { nodes: laid, communities, idIndex };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function countLabel(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

interface Transform {
  tx: number;
  ty: number;
  scale: number;
}

const IDENTITY_TRANSFORM: Transform = { tx: 0, ty: 0, scale: 1 };

interface Augment {
  nodes: KGNode[];
  edges: KGEdge[];
  /** Last node we expanded around — drives the "new nodes ring" seed. */
  expandedFrom: string | null;
}

const EMPTY_AUGMENT: Augment = { nodes: [], edges: [], expandedFrom: null };

export const KnowledgeGraphView = (): React.JSX.Element => {
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [database, setDatabase] = useState<KGDatabase>('codebase');
  const [view, setView] = useState<KGView>('summary');
  const [augment, setAugment] = useState<Augment>(EMPTY_AUGMENT);
  const [expanding, setExpanding] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KGNode[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Active project drives which repo's graph we display. The codebase tab
  // scopes by the project root so several repos can share one Neo4j DB
  // without overlapping; the memory tab is project-agnostic for now.
  const allProjects = useStore((s) => s.projects);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const selectProject = useStore((s) => s.selectProject);

  // Ensure projects are loaded when the graph view mounts
  useEffect(() => {
    if (allProjects.length === 0) {
      void fetchProjects();
    }
  }, [allProjects.length, fetchProjects]);
  const activeProject = useStore((s) => {
    const id = s.selectedProjectId;
    if (!id) return null;
    return s.projects.find((p) => p.id === id) ?? null;
  });
  const projectRoot = activeProject?.path ?? null;
  const effectiveProjectRoot = database === 'memory' ? undefined : (projectRoot ?? undefined);
  const [transform, setTransform] = useState<Transform>(IDENTITY_TRANSFORM);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; t0: Transform; moved: boolean } | null>(
    null
  );
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1200, h: 420 });
  // Layout cache lets new augment additions slot in without resetting the
  // existing layout. Keyed by the base graph identity so a fresh query
  // (db/view switch) starts cold.
  const layoutCacheRef = useRef<{
    key: KGGraphResponse | null;
    positions: Map<string, { x: number; y: number }>;
  } | null>(null);

  // -- Bring up the sidecar + first query.
  const loadGraph = useCallback(
    async (db: KGDatabase, kgView: KGView, scopedRoot: string | undefined): Promise<void> => {
      const api = window.electronAPI?.knowledgeGraph;
      if (!api) {
        setState({
          kind: 'error',
          message: 'Knowledge graph API not available in this build.',
          canRetry: false,
        });
        return;
      }
      try {
        setState({ kind: 'starting', message: 'Starting knowledge graph service…' });
        const health: KGHealth = await api.start();
        if (health.serverStatus !== 'running') {
          setState({
            kind: 'error',
            message:
              health.lastError ?? `Sidecar failed to start (status: ${health.serverStatus}).`,
            canRetry: true,
          });
          return;
        }
        if (health.neo4jStatus === 'unreachable') {
          setState({
            kind: 'error',
            message: 'Neo4j is not reachable. Run `docker compose up -d neo4j` and retry.',
            canRetry: true,
          });
          return;
        }
        setState({ kind: 'loading', message: 'Loading graph…' });
        const data = await api.query({
          db,
          view: kgView,
          limit: kgView === 'detail' ? 600 : 300,
          projectRoot: scopedRoot,
        });
        // Fresh query → drop augmentation + cached positions so the new
        // graph lays out from scratch.
        setAugment(EMPTY_AUGMENT);
        layoutCacheRef.current = null;
        setState({ kind: 'ready', data });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message, canRetry: true });
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    setPinned(null);
    setHovered(null);
    void (async () => {
      if (cancelled) return;
      await loadGraph(database, view, effectiveProjectRoot);
    })();
    return (): void => {
      cancelled = true;
    };
  }, [database, view, effectiveProjectRoot, loadGraph]);

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

  // -- Esc clears the pinned node.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPinned(null);
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [pinned]);

  // -- Debounced search against /api/search.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setSearchResults([]);
      return;
    }
    const api = window.electronAPI?.knowledgeGraph;
    if (!api) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await api.search({
            db: database,
            q: trimmed,
            limit: 8,
            projectRoot: effectiveProjectRoot,
          });
          if (!cancelled) setSearchResults(result.results);
        } catch {
          if (!cancelled) setSearchResults([]);
        }
      })();
    }, 180);
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, database, effectiveProjectRoot]);

  // -- Merge base graph + augmentation (deduped by id).
  const merged = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const nodeMap = new Map<string, KGNode>();
    for (const n of state.data.nodes) nodeMap.set(n.id, n);
    for (const n of augment.nodes) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
    const edgeMap = new Map<string, KGEdge>();
    for (const e of state.data.edges) edgeMap.set(e.id, e);
    for (const e of augment.edges) if (!edgeMap.has(e.id)) edgeMap.set(e.id, e);
    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    };
  }, [state, augment]);

  // -- Compute layout, reusing prior positions for stable re-layouts when
  //    only augmentation changes. Cache key is the base graph identity, so
  //    a fresh query (db/view switch) restarts cold.
  const layoutResult = useMemo(() => {
    if (state.kind !== 'ready' || !merged) return null;
    const cache = layoutCacheRef.current;
    const useSeed = cache && cache.key === state.data;
    const seed = useSeed ? cache!.positions : undefined;
    const result = layout(merged.nodes, merged.edges, size.w, size.h, {
      seed,
      anchorId: augment.expandedFrom ?? undefined,
    });
    const positions = new Map<string, { x: number; y: number }>();
    for (const n of result.nodes) positions.set(n.id, { x: n.x, y: n.y });
    layoutCacheRef.current = { key: state.data, positions };
    return result;
  }, [state, merged, size.w, size.h, augment.expandedFrom]);

  // -- Edge coordinates + adjacency for hover focus.
  const { drawnEdges, adjacency } = useMemo(() => {
    if (!layoutResult || !merged) {
      return { drawnEdges: [], adjacency: new Map<string, Set<string>>() };
    }
    const { idIndex } = layoutResult;
    const edges: {
      id: string;
      source: string;
      target: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
    }[] = [];
    const adj = new Map<string, Set<string>>();
    for (const edge of merged.edges) {
      const a = idIndex.get(edge.source);
      const b = idIndex.get(edge.target);
      if (!a || !b) continue;
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        color: a.color,
      });
      let aSet = adj.get(edge.source);
      if (!aSet) {
        aSet = new Set<string>();
        adj.set(edge.source, aSet);
      }
      aSet.add(edge.target);
      let bSet = adj.get(edge.target);
      if (!bSet) {
        bSet = new Set<string>();
        adj.set(edge.target, bSet);
      }
      bSet.add(edge.source);
    }
    return { drawnEdges: edges, adjacency: adj };
  }, [layoutResult, merged]);

  // -- Pinned beats hover. Click → freeze focus until clicking elsewhere.
  const focusId = pinned ?? hovered;
  const focus = useMemo(() => {
    if (!focusId) return null;
    const neighbors = adjacency.get(focusId) ?? new Set<string>();
    const activeNodes = new Set<string>(neighbors);
    activeNodes.add(focusId);
    return { hovered: focusId, activeNodes, neighbors, isPinned: focusId === pinned };
  }, [focusId, pinned, adjacency]);

  // -- Wheel zoom, anchored at the pointer position.
  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * size.w;
      const py = ((event.clientY - rect.top) / rect.height) * size.h;
      setTransform((prev) => {
        const factor = Math.exp(-event.deltaY * 0.0015);
        const next = clamp(prev.scale * factor, MIN_ZOOM, MAX_ZOOM);
        // Keep the world-space point under the cursor stationary on zoom.
        const wx = (px - prev.tx) / prev.scale;
        const wy = (py - prev.ty) / prev.scale;
        return { scale: next, tx: px - wx * next, ty: py - wy * next };
      });
    },
    [size.h, size.w]
  );

  // -- Pointer drag pans the canvas. Tracks `moved` so click-vs-drag can
  // distinguish a node selection from a pan that ended over a node.
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      svg.setPointerCapture(event.pointerId);
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        t0: transform,
        moved: false,
      };
    },
    [transform]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dxClient = event.clientX - drag.startX;
      const dyClient = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dxClient, dyClient) > 4) {
        drag.moved = true;
      }
      const dx = (dxClient / rect.width) * size.w;
      const dy = (dyClient / rect.height) * size.h;
      setTransform({ scale: drag.t0.scale, tx: drag.t0.tx + dx, ty: drag.t0.ty + dy });
    },
    [size.h, size.w]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const svg = svgRef.current;
    if (svg && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    // Click on empty SVG (no drag, target is the svg itself) clears the pin.
    if (drag && !drag.moved && event.target === svg) {
      setPinned(null);
    }
  }, []);

  const handleNodeClick = useCallback((event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    const drag = dragRef.current;
    if (drag?.moved) return; // pan, not click
    setPinned((prev) => (prev === id ? null : id));
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      setTransform((prev) => {
        const cx = size.w / 2;
        const cy = size.h / 2;
        const next = clamp(prev.scale * factor, MIN_ZOOM, MAX_ZOOM);
        const wx = (cx - prev.tx) / prev.scale;
        const wy = (cy - prev.ty) / prev.scale;
        return { scale: next, tx: cx - wx * next, ty: cy - wy * next };
      });
    },
    [size.h, size.w]
  );

  const resetView = useCallback(() => setTransform(IDENTITY_TRANSFORM), []);

  // -- Center the camera on a world-space point at a given scale.
  const centerOn = useCallback(
    (worldX: number, worldY: number, targetScale = 2.5) => {
      const next = clamp(targetScale, MIN_ZOOM, MAX_ZOOM);
      setTransform({
        scale: next,
        tx: size.w / 2 - worldX * next,
        ty: size.h / 2 - worldY * next,
      });
    },
    [size.h, size.w]
  );

  // -- Expand: fetch /api/node/{id}/neighbors and merge into the graph.
  const expandNode = useCallback(
    async (id: string) => {
      const api = window.electronAPI?.knowledgeGraph;
      if (!api) return;
      setExpanding(true);
      try {
        const result = await api.neighbors({
          nodeId: id,
          db: database,
          depth: 1,
          projectRoot: effectiveProjectRoot,
        });
        setAugment((prev) => {
          const existingNodeIds = new Set(prev.nodes.map((n) => n.id));
          const existingEdgeIds = new Set(prev.edges.map((e) => e.id));
          const baseNodeIds = new Set(
            state.kind === 'ready' ? state.data.nodes.map((n) => n.id) : []
          );
          const baseEdgeIds = new Set(
            state.kind === 'ready' ? state.data.edges.map((e) => e.id) : []
          );
          const nextNodes = [...prev.nodes];
          for (const n of result.nodes) {
            if (existingNodeIds.has(n.id) || baseNodeIds.has(n.id)) continue;
            nextNodes.push(n);
            existingNodeIds.add(n.id);
          }
          const nextEdges = [...prev.edges];
          for (const e of result.edges) {
            if (existingEdgeIds.has(e.id) || baseEdgeIds.has(e.id)) continue;
            nextEdges.push(e);
            existingEdgeIds.add(e.id);
          }
          return { nodes: nextNodes, edges: nextEdges, expandedFrom: id };
        });
      } catch {
        /* surface via console — caller can re-click */
      } finally {
        setExpanding(false);
      }
    },
    [database, effectiveProjectRoot, state]
  );

  // -- Pick a node from search results: pin + center; if it's not in the
  //    current layout, expand it via the neighbors endpoint first so it
  //    has somewhere to land.
  const focusOnNode = useCallback(
    async (nodeId: string) => {
      setSearchOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      const known = layoutResult?.idIndex.get(nodeId);
      if (known) {
        setPinned(nodeId);
        centerOn(known.x, known.y, 2.5);
        return;
      }
      await expandNode(nodeId);
      setPinned(nodeId);
    },
    [centerOn, expandNode, layoutResult]
  );

  // -- Trigger an index pass against the active project. Used by the
  //    empty-state CTA when a project hasn't been ingested yet.
  const triggerReindex = useCallback(async (): Promise<void> => {
    const api = window.electronAPI?.knowledgeGraph;
    if (!api || !projectRoot) return;
    setReindexing(true);
    try {
      const result = await api.reindex({ projectRoot });
      if (result.exitCode !== 0) {
        setState({
          kind: 'error',
          message:
            result.stderrTail.trim().split('\n').slice(-3).join('\n') ||
            `Indexer exited with code ${result.exitCode}.`,
          canRetry: true,
        });
        return;
      }
      // Re-query the (now hopefully populated) graph.
      await loadGraph(database, view, effectiveProjectRoot);
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        canRetry: true,
      });
    } finally {
      setReindexing(false);
    }
  }, [database, effectiveProjectRoot, loadGraph, projectRoot, view]);

  // After expansion adds a pinned node, recenter once the layout settles.
  useEffect(() => {
    if (!pinned) return;
    const node = layoutResult?.idIndex.get(pinned);
    if (!node) return;
    // Only recenter if the node is far from where the camera currently
    // looks; avoids fighting the user's manual pan after they've moved
    // away from the pinned region.
    const wx = (size.w / 2 - transform.tx) / transform.scale;
    const wy = (size.h / 2 - transform.ty) / transform.scale;
    const offCenter = Math.hypot(node.x - wx, node.y - wy);
    if (offCenter > 80 && augment.expandedFrom === pinned) {
      centerOn(node.x, node.y, Math.max(transform.scale, 2));
    }
    // Deliberately omit transform from deps — this fires on layout change,
    // not on every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, augment.expandedFrom, layoutResult]);

  // No project picked yet → tell the user how to get one. Memory tab is
  // project-agnostic so we only show this on the codebase side.
  const needsProjectPick = database === 'codebase' && !projectRoot;
  // Graph fetched OK but the active project isn't indexed yet.
  const isEmptyAfterFetch =
    state.kind === 'ready' && (merged?.nodes.length ?? 0) === 0 && !needsProjectPick;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {needsProjectPick ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="font-serif text-[18px] text-[color:var(--ink-1)]">
            Pick a project to see its graph.
          </p>
          {allProjects.length > 0 ? (
            <div className="flex max-h-[320px] w-full max-w-[480px] flex-col gap-1.5 overflow-y-auto rounded-xl border border-white/20 bg-white/5 p-3">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/10"
                >
                  <span className="bg-[color:var(--a-violet)]/15 flex size-8 shrink-0 items-center justify-center rounded-lg text-[14px] text-[color:var(--a-violet)]">
                    {(p.name?.[0] ?? p.path.split('/').pop()?.[0] ?? '?').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[color:var(--ink-1)]">
                      {p.name || p.path.split('/').pop()}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-[color:var(--ink-3)]">
                      {p.path.replace(/^\/Users\/[^/]+\//, '~/')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="max-w-[480px] text-[13px] text-[color:var(--ink-2)]">
              No projects found. Open a project from the command bar (⌘K) or switch to the{' '}
              <em className="italic">memory</em> tab.
            </p>
          )}
        </div>
      ) : isEmptyAfterFetch ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="font-serif text-[18px] text-[color:var(--ink-1)]">
            {projectRoot ? "This project hasn't been indexed yet." : 'No graph data yet.'}
          </p>
          {projectRoot ? (
            <p className="max-w-[480px] truncate text-[12px] text-[color:var(--ink-3)]">
              {projectRoot}
            </p>
          ) : null}
          <button
            type="button"
            onClick={(): void => {
              void triggerReindex();
            }}
            disabled={reindexing || !projectRoot}
            className="mt-2 rounded-full bg-[color:var(--ink-1)] px-4 py-1.5 text-[12px] text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {reindexing ? 'Indexing…' : 'Index this project'}
          </button>
          <p className="max-w-[420px] text-[11px] text-[color:var(--ink-3)]">
            Tree-sitter walks every file under the project root and writes the symbol graph into
            Neo4j. First pass on a 100-file repo takes a few seconds.
          </p>
        </div>
      ) : state.kind === 'ready' && layoutResult ? (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 h-full w-full select-none"
            aria-label="Neo4j knowledge graph"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
          >
            <g transform={`translate(${transform.tx} ${transform.ty}) scale(${transform.scale})`}>
              <g strokeWidth={0.6 / transform.scale}>
                {drawnEdges.map((e) => {
                  const incident =
                    !focus || e.source === focus.hovered || e.target === focus.hovered;
                  const opacity = focus ? (incident ? 0.9 : 0.05) : 0.45;
                  const sw = (incident && focus ? 1.6 : 0.6) / transform.scale;
                  return (
                    <line
                      key={e.id}
                      x1={e.x1}
                      y1={e.y1}
                      x2={e.x2}
                      y2={e.y2}
                      stroke={e.color}
                      strokeWidth={sw}
                      opacity={opacity}
                    />
                  );
                })}
              </g>
              <g>
                {layoutResult.nodes.map((n) => {
                  const isFocused = focus?.hovered === n.id;
                  const isPinned = pinned === n.id;
                  const isActive = focus?.activeNodes.has(n.id) ?? true;
                  const fillOpacity = focus ? (isActive ? 0.95 : 0.15) : 0.92;
                  const strokeWidth = (isPinned ? 2.4 : isFocused ? 2 : 0.5) / transform.scale;
                  return (
                    <g key={n.id}>
                      {isPinned ? (
                        <circle
                          cx={n.x}
                          cy={n.y}
                          r={n.size + 4 / transform.scale}
                          fill="none"
                          stroke={n.color}
                          strokeWidth={1.5 / transform.scale}
                          opacity={0.7}
                          style={{ pointerEvents: 'none' }}
                        />
                      ) : null}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={n.size}
                        fill={n.color}
                        fillOpacity={fillOpacity}
                        stroke={
                          isPinned
                            ? 'rgba(20,19,26,0.95)'
                            : isFocused
                              ? 'rgba(20,19,26,0.85)'
                              : 'rgba(255,255,255,0.7)'
                        }
                        strokeWidth={strokeWidth}
                        onMouseEnter={(): void => setHovered(n.id)}
                        onMouseLeave={(): void => setHovered(null)}
                        onClick={(e): void => handleNodeClick(e, n.id)}
                        style={{ cursor: 'pointer', transition: 'fill-opacity 120ms ease' }}
                      >
                        <title>{n.label}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>

          {/* Top control row: DB selector + view toggle + search */}
          <div className="absolute left-3 right-3 top-3 flex items-start gap-2">
            <div className="inline-flex overflow-hidden rounded-full bg-white/65 p-0.5 font-mono text-[11px] shadow-sm backdrop-blur-sm">
              {(['codebase', 'memory'] as const).map((db) => (
                <button
                  key={db}
                  type="button"
                  onClick={(): void => setDatabase(db)}
                  aria-pressed={database === db}
                  className={`rounded-full px-3 py-1 transition ${
                    database === db
                      ? 'bg-[color:var(--ink-1)] text-white'
                      : 'text-[color:var(--ink-2)] hover:bg-white/70'
                  }`}
                >
                  {db}
                </button>
              ))}
            </div>
            {database === 'codebase' && projectRoot && allProjects.length > 1 && (
              <div className="group relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/65 px-3 py-1 font-mono text-[11px] text-[color:var(--ink-2)] shadow-sm backdrop-blur-sm transition hover:bg-white/80"
                >
                  <span className="max-w-[140px] truncate">
                    {activeProject?.name || projectRoot.split('/').pop()}
                  </span>
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M1.5 3 4 5.5 6.5 3" />
                  </svg>
                </button>
                <ul className="invisible absolute left-0 top-full z-10 mt-1 max-h-[200px] w-64 overflow-auto rounded-lg bg-white/95 py-1 font-mono text-[11px] shadow-lg ring-1 ring-black/5 group-hover:visible">
                  {allProjects.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => selectProject(p.id)}
                        className={
                          'block w-full truncate px-3 py-1.5 text-left hover:bg-black/5' +
                          (p.id === activeProject?.id
                            ? ' font-semibold text-[color:var(--a-violet)]'
                            : '')
                        }
                      >
                        {p.name || p.path.split('/').pop()}
                        <span className="ml-1 opacity-40">
                          {p.path.replace(/^\/Users\/[^/]+\//, '~/')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="inline-flex overflow-hidden rounded-full bg-white/65 p-0.5 font-mono text-[11px] shadow-sm backdrop-blur-sm">
              {(['summary', 'detail'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={(): void => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded-full px-3 py-1 transition ${
                    view === v
                      ? 'bg-[color:var(--ink-1)] text-white'
                      : 'text-[color:var(--ink-2)] hover:bg-white/70'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <input
                type="text"
                value={searchQuery}
                onChange={(e): void => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={(): void => setSearchOpen(true)}
                onBlur={(): void => {
                  // Delay so click on a result registers before close.
                  setTimeout(() => setSearchOpen(false), 150);
                }}
                placeholder="Search nodes…"
                className="w-56 rounded-full border border-transparent bg-white/65 px-3 py-1 font-mono text-[11px] text-[color:var(--ink-1)] shadow-sm backdrop-blur-sm placeholder:text-[color:var(--ink-3)] focus:border-[color:var(--ink-2)] focus:outline-none"
              />
              {searchOpen && searchResults.length > 0 ? (
                <ul className="absolute right-0 mt-1 max-h-[260px] w-72 overflow-auto rounded-lg bg-white/95 py-1 font-mono text-[11px] shadow-lg ring-1 ring-black/5">
                  {searchResults.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="block w-full truncate px-3 py-1.5 text-left hover:bg-black/5"
                        onMouseDown={(e): void => e.preventDefault()}
                        onClick={(): void => {
                          void focusOnNode(n.id);
                        }}
                      >
                        <span className="text-[color:var(--ink-1)]">{n.label}</span>
                        <span className="ml-2 text-[10px] text-[color:var(--ink-3)]">{n.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* Counts pill */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/55 px-2 py-1 font-mono text-[11px] text-[color:var(--ink-2)]">
            {countLabel(merged?.nodes.length ?? 0, 'node')} ·{' '}
            {countLabel(merged?.edges.length ?? 0, 'edge')}
            {augment.nodes.length > 0 ? ` · +${augment.nodes.length} expanded` : ''}
            {state.data.hidden_hubs ? ` · ${state.data.hidden_hubs} hubs hidden` : ''}
          </div>

          {/* Color legend */}
          {layoutResult.communities.length > 1 ? (
            <div className="pointer-events-none absolute left-3 top-12 max-h-[180px] overflow-auto rounded-lg bg-white/65 px-2 py-1.5 font-mono text-[10px] shadow-sm backdrop-blur-sm">
              <div className="mb-1 text-[9px] uppercase tracking-wider text-[color:var(--ink-3)]">
                Communities
              </div>
              <ul className="space-y-0.5">
                {layoutResult.communities.slice(0, 12).map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{
                        backgroundColor: colorForCommunity(c, layoutResult.communities),
                      }}
                    />
                    <span className="truncate text-[color:var(--ink-2)]">
                      {c === FALLBACK_COMMUNITY ? '(none)' : c}
                    </span>
                  </li>
                ))}
                {layoutResult.communities.length > 12 ? (
                  <li className="text-[color:var(--ink-3)]">
                    +{layoutResult.communities.length - 12} more
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* Zoom controls */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-white/65 px-1 py-1 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              onClick={(): void => zoomBy(0.8)}
              aria-label="Zoom out"
              className="h-7 w-7 rounded-full font-mono text-[14px] text-[color:var(--ink-1)] hover:bg-white/80"
            >
              −
            </button>
            <span className="px-1 font-mono text-[11px] tabular-nums text-[color:var(--ink-2)]">
              {transform.scale.toFixed(1)}×
            </span>
            <button
              type="button"
              onClick={(): void => zoomBy(1.25)}
              aria-label="Zoom in"
              className="h-7 w-7 rounded-full font-mono text-[14px] text-[color:var(--ink-1)] hover:bg-white/80"
            >
              +
            </button>
            <button
              type="button"
              onClick={resetView}
              aria-label="Reset view"
              className="ml-1 rounded-full px-2 font-mono text-[11px] text-[color:var(--ink-2)] hover:bg-white/80"
            >
              reset
            </button>
          </div>

          {/* Hover / pinned detail */}
          {focus && layoutResult.idIndex.get(focus.hovered) ? (
            <div className="absolute right-3 top-12 max-w-[320px] rounded-lg bg-white/90 px-3 py-2 font-mono text-[11px] text-[color:var(--ink-1)] shadow-lg ring-1 ring-black/5">
              <div className="flex items-start gap-2">
                <span className="break-all font-semibold">
                  {layoutResult.idIndex.get(focus.hovered)!.label}
                </span>
                {focus.isPinned ? (
                  <button
                    type="button"
                    onClick={(): void => setPinned(null)}
                    aria-label="Clear pinned node"
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] text-[color:var(--ink-2)] hover:bg-white/80"
                  >
                    clear
                  </button>
                ) : null}
              </div>
              <div className="mt-0.5 text-[10px] text-[color:var(--ink-2)]">
                {countLabel(focus.neighbors.size, 'neighbor')}
                {focus.isPinned ? '' : ' · click to pin'}
              </div>
              {focus.isPinned ? (
                <button
                  type="button"
                  onClick={(): void => {
                    void expandNode(focus.hovered);
                  }}
                  disabled={expanding}
                  className="mt-2 w-full rounded-full bg-[color:var(--ink-1)] px-3 py-1 text-[11px] text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {expanding ? 'Expanding…' : 'Expand neighbors'}
                </button>
              ) : null}
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
              onClick={(): void => {
                void loadGraph(database, view, effectiveProjectRoot);
              }}
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
