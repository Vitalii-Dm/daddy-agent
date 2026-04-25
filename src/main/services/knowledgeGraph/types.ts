/**
 * Internal contracts for the knowledge-graph subsystem.
 *
 * Two collaborators behind the IPC handler:
 *   - `IPythonVizServer` — owns the OS-level subprocess (start/stop/health).
 *   - `IKnowledgeGraphProxy` — speaks HTTP to that subprocess.
 *
 * They are split so the IPC layer can be unit-tested with two trivial fakes,
 * and so each can be replaced independently (e.g. swap the proxy for a Node
 * neo4j-driver client without touching the lifecycle).
 */

import type {
  KGEvent,
  KGGraphRequest,
  KGGraphResponse,
  KGHealth,
  KGNeighborsRequest,
  KGNeighborsResponse,
  KGSearchRequest,
  KGSearchResponse,
} from '@shared/types/knowledgeGraph';

export interface PythonVizServerOptions {
  /** Defaults to 9750 to avoid colliding with the default `daddy-viz` (9749). */
  port?: number;
  host?: string;
  /** Extra environment overrides (NEO4J_URI, NEO4J_PASSWORD, …). */
  env?: NodeJS.ProcessEnv;
  /** Override the executable used to launch the server (defaults to `python3`). */
  pythonBin?: string;
  /** Optional working directory; defaults to the repo root. */
  cwd?: string;
}

export interface PythonVizServerEventMap {
  /** Subprocess transitioned to `running` (port is reachable). */
  ready: () => void;
  /** Subprocess crashed or was terminated externally. */
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
  /** A non-fatal stderr line worth surfacing to the renderer. */
  stderr: (line: string) => void;
}

export interface IPythonVizServer {
  /** Idempotent: if already running, returns the current health. */
  start(): Promise<KGHealth>;
  /** Idempotent. */
  stop(): Promise<KGHealth>;
  getHealth(): Promise<KGHealth>;
  /** Base URL for the proxy (e.g. `http://localhost:9750`). Throws if stopped. */
  baseUrl(): string;
  on<E extends keyof PythonVizServerEventMap>(
    event: E,
    listener: PythonVizServerEventMap[E]
  ): void;
  off<E extends keyof PythonVizServerEventMap>(
    event: E,
    listener: PythonVizServerEventMap[E]
  ): void;
}

export interface IKnowledgeGraphProxy {
  query(request?: KGGraphRequest): Promise<KGGraphResponse>;
  search(request: KGSearchRequest): Promise<KGSearchResponse>;
  neighbors(request: KGNeighborsRequest): Promise<KGNeighborsResponse>;
  /** Subscribes to `/events`; returns an unsubscribe fn. */
  subscribe(callback: (event: KGEvent) => void): () => void;
}
