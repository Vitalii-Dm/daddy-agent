/**
 * Type contracts for the Neo4j knowledge graph backend.
 *
 * The renderer never speaks HTTP; it goes through Electron IPC, which the main
 * process proxies to a locally-spawned Python FastAPI server. The shapes below
 * mirror the JSON returned by `daddy_agent.viz.server` (see
 * `src/daddy_agent/viz/server.py`) — keep them in sync.
 */

export type KGDatabase = 'codebase' | 'memory';

export type KGView = 'summary' | 'detail';

/**
 * Closed whitelist mirrored from `ALLOWED_NODE_LABELS` in
 * `src/daddy_agent/viz/server.py`. Detail-view `type` filter must be one of
 * these — anything else is rejected upstream with HTTP 400.
 */
export const KG_ALLOWED_NODE_LABELS = [
  'File',
  'Function',
  'Class',
  'Method',
  'Module',
  'Variable',
  'Community',
  'Session',
  'Message',
  'Entity',
  'Preference',
  'ReasoningTrace',
  'ToolCall',
] as const;

export type KGNodeLabel = (typeof KG_ALLOWED_NODE_LABELS)[number];

export interface KGNode {
  id: string;
  label: string;
  type: string;
  labels: string[];
  community: string | null;
  attributes: Record<string, unknown>;
  size: number;
  degree: number;
}

export interface KGEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  attributes: Record<string, unknown>;
}

export interface KGHiddenHub {
  name: string;
  fan_in: number;
}

export interface KGGraphRequest {
  db?: KGDatabase;
  view?: KGView;
  limit?: number;
  /** Detail-view only. Must be in `KG_ALLOWED_NODE_LABELS`. */
  type?: KGNodeLabel;
  /** Detail-view only. */
  community?: string;
  /** Summary-view only. Module fan-in cutoff for hub culling. */
  hubThreshold?: number;
  /**
   * Absolute filesystem path of the project to scope the graph to. The
   * indexer writes this onto every node so multiple repos can cohabit one
   * Neo4j DB; the renderer always sends the active project's path so the
   * graph reflects the current workspace.
   */
  projectRoot?: string;
}

export interface KGGraphResponse {
  nodes: KGNode[];
  edges: KGEdge[];
  view: KGView;
  hidden_hubs?: number;
  hidden_hub_list?: KGHiddenHub[];
}

export interface KGSearchRequest {
  db?: KGDatabase;
  q: string;
  limit?: number;
  projectRoot?: string;
}

export interface KGSearchResponse {
  results: KGNode[];
}

export interface KGNeighborsRequest {
  nodeId: string;
  db?: KGDatabase;
  /** 1..3 inclusive (clamped server-side). */
  depth?: number;
  projectRoot?: string;
}

export interface KGNeighborsResponse {
  nodes: KGNode[];
  edges: KGEdge[];
}

/**
 * Health snapshot of the Python sidecar + the Neo4j driver behind it.
 *
 * `serverStatus` describes the Python FastAPI subprocess; `neo4jStatus`
 * describes whether `/healthz` could reach the database.
 */
export type KGServerStatus = 'stopped' | 'starting' | 'running' | 'crashed';
export type KGNeo4jStatus = 'unknown' | 'reachable' | 'unreachable';

export interface KGHealth {
  serverStatus: KGServerStatus;
  neo4jStatus: KGNeo4jStatus;
  port: number | null;
  pid: number | null;
  /** Last error surfaced by the lifecycle or the proxy. */
  lastError: string | null;
}

/**
 * Live SSE event from the Python `/events` stream, normalized to a single
 * envelope. Heartbeats are dropped before reaching the renderer; what
 * survives is structural change notifications.
 */
export type KGEvent =
  | { kind: 'graph-updated'; signature: string; ts: number }
  | { kind: 'error'; error: string }
  | { kind: 'connection'; connected: boolean };

/**
 * Trigger an indexing pass against an arbitrary repo. The main process spawns
 * `daddy-index <projectRoot>` and reports back when it exits. Used by the
 * renderer's "Index this project" button when the active project has no
 * graph yet.
 */
export interface KGReindexRequest {
  projectRoot: string;
  /** If true, ignore cached hashes and re-ingest every file. */
  full?: boolean;
}

export interface KGReindexResult {
  projectRoot: string;
  exitCode: number;
  /** Tail of stderr — useful for surfacing errors to the renderer. */
  stderrTail: string;
  durationMs: number;
}
