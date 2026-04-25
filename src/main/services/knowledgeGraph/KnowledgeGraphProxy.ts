/**
 * HTTP client for the locally-spawned `daddy_agent.viz` FastAPI sidecar.
 *
 * Owns nothing except the wire — the subprocess lifecycle lives behind
 * `IPythonVizServer` and is consumed via `server.baseUrl()` per request so
 * restarts (port changes) are picked up transparently.
 *
 * Errors thrown here are translated by the IPC layer into
 * `{ success: false, error }` envelopes; this class never masks failures.
 */

import { createLogger } from '@shared/utils/logger';
import type {
  KGEvent,
  KGGraphRequest,
  KGGraphResponse,
  KGNeighborsRequest,
  KGNeighborsResponse,
  KGSearchRequest,
  KGSearchResponse,
} from '@shared/types/knowledgeGraph';

import type { IKnowledgeGraphProxy, IPythonVizServer } from './types';

const logger = createLogger('KG:Proxy');

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

/** Snake-case translation for the few camelCase TS request fields. */
function appendParam(
  params: URLSearchParams,
  key: string,
  value: string | number | undefined
): void {
  if (value === undefined || value === null) return;
  params.append(key, String(value));
}

function buildGraphQuery(req: KGGraphRequest | undefined): string {
  if (!req) return '';
  const params = new URLSearchParams();
  appendParam(params, 'db', req.db);
  appendParam(params, 'view', req.view);
  appendParam(params, 'limit', req.limit);
  appendParam(params, 'type', req.type);
  appendParam(params, 'community', req.community);
  appendParam(params, 'hub_threshold', req.hubThreshold);
  appendParam(params, 'project_root', req.projectRoot);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildSearchQuery(req: KGSearchRequest): string {
  const params = new URLSearchParams();
  appendParam(params, 'db', req.db);
  // `q` is required by the contract — still guard against empty string at the
  // boundary by always appending whatever the caller passed; the server will
  // 4xx if it's missing.
  params.append('q', req.q);
  appendParam(params, 'limit', req.limit);
  appendParam(params, 'project_root', req.projectRoot);
  return `?${params.toString()}`;
}

function buildNeighborsQuery(req: KGNeighborsRequest): string {
  const params = new URLSearchParams();
  appendParam(params, 'db', req.db);
  appendParam(params, 'depth', req.depth);
  appendParam(params, 'project_root', req.projectRoot);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Pull `error` out of a JSON 4xx/5xx body if present. Falls back to status text.
 * Never throws — failures here just produce a generic "<statusText>" message.
 */
async function extractError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (data && typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  } catch {
    /* not JSON — fall through */
  }
  return response.statusText || `HTTP ${response.status}`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export class KnowledgeGraphProxy implements IKnowledgeGraphProxy {
  constructor(private readonly server: IPythonVizServer) {}

  async query(request?: KGGraphRequest): Promise<KGGraphResponse> {
    const url = `${this.server.baseUrl()}/api/graph${buildGraphQuery(request)}`;
    const data = await this.fetchJson<KGGraphResponse>(url);
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error('KG response shape invalid: nodes/edges not arrays');
    }
    return data;
  }

  async search(request: KGSearchRequest): Promise<KGSearchResponse> {
    const url = `${this.server.baseUrl()}/api/search${buildSearchQuery(request)}`;
    const data = await this.fetchJson<KGSearchResponse>(url);
    if (!Array.isArray(data.results)) {
      throw new Error('KG search response shape invalid: results not array');
    }
    return data;
  }

  async neighbors(request: KGNeighborsRequest): Promise<KGNeighborsResponse> {
    const encoded = encodeURIComponent(request.nodeId);
    const url = `${this.server.baseUrl()}/api/node/${encoded}/neighbors${buildNeighborsQuery(request)}`;
    const data = await this.fetchJson<KGNeighborsResponse>(url);
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error('KG neighbors response shape invalid: nodes/edges not arrays');
    }
    return data;
  }

  /**
   * Open an SSE stream against `<baseUrl>/events`. On every disconnect we emit
   * a `connection: false` event and reconnect after a 2s..30s backoff window.
   * The returned function aborts the in-flight fetch and stops further
   * reconnect attempts.
   */
  subscribe(callback: (event: KGEvent) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = RECONNECT_BASE_MS;

    const scheduleReconnect = (): void => {
      if (stopped) return;
      const delay = Math.min(backoffMs, RECONNECT_MAX_MS);
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async (): Promise<void> => {
      if (stopped) return;
      controller = new AbortController();
      let url: string;
      try {
        url = `${this.server.baseUrl()}/events`;
      } catch (err) {
        logger.debug('subscribe: baseUrl() unavailable, will retry', err);
        callback({ kind: 'connection', connected: false });
        scheduleReconnect();
        return;
      }

      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
      } catch (err) {
        if (isAbortError(err) || stopped) return;
        logger.debug('subscribe: fetch failed', err);
        callback({ kind: 'connection', connected: false });
        scheduleReconnect();
        return;
      }

      if (!response.ok || !response.body) {
        logger.debug('subscribe: non-OK response', response.status);
        callback({ kind: 'connection', connected: false });
        scheduleReconnect();
        return;
      }

      callback({ kind: 'connection', connected: true });
      // Successful open → reset backoff for the next failure cycle.
      backoffMs = RECONNECT_BASE_MS;

      try {
        await consumeEventStream(response.body, callback);
        // Stream ended cleanly (server closed) — treat as disconnect.
        if (!stopped) {
          callback({ kind: 'connection', connected: false });
          scheduleReconnect();
        }
      } catch (err) {
        if (isAbortError(err) || stopped) return;
        logger.debug('subscribe: stream error', err);
        callback({ kind: 'connection', connected: false });
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (controller) {
        controller.abort();
      }
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      logger.debug('fetch failed', url, err);
      throw new Error('Knowledge graph server unreachable');
    }

    if (!response.ok) {
      const message = await extractError(response);
      throw new Error(`KG ${response.status}: ${message}`);
    }

    try {
      return (await response.json()) as T;
    } catch (err) {
      logger.debug('json parse failed', url, err);
      throw new Error('KG response was not valid JSON');
    }
  }
}

/**
 * Drive an SSE-formatted stream into `callback`. Heartbeat lines (`:` prefix)
 * are dropped. Each event is a sequence of `event: <name>` / `data: <body>`
 * lines terminated by a blank line.
 */
async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  callback: (event: KGEvent) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE messages are separated by a blank line ("\n\n"). Some servers send
      // CRLFs — normalize before splitting.
      const normalized = buffer.replace(/\r\n/g, '\n');
      const parts = normalized.split('\n\n');
      // Last segment may be a partial message — keep it in the buffer.
      buffer = parts.pop() ?? '';

      for (const raw of parts) {
        const message = parseSseMessage(raw);
        if (!message) continue;
        dispatch(message, callback);
      }
    }
    // Flush any trailing complete message that lacked a closing blank line.
    if (buffer.length > 0) {
      const message = parseSseMessage(buffer);
      if (message) dispatch(message, callback);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* lock may already be released if the body was cancelled */
    }
  }
}

interface SseMessage {
  event: string;
  data: string;
}

function parseSseMessage(block: string): SseMessage | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue; // heartbeat / comment
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
    // Other SSE fields (id, retry) are ignored — Python server doesn't emit them.
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

function dispatch(msg: SseMessage, callback: (event: KGEvent) => void): void {
  if (msg.event === 'graph-updated') {
    let payload: { signature?: unknown; ts?: unknown };
    try {
      payload = JSON.parse(msg.data) as { signature?: unknown; ts?: unknown };
    } catch (err) {
      logger.debug('subscribe: bad graph-updated payload', err);
      return;
    }
    if (typeof payload.signature !== 'string' || typeof payload.ts !== 'number') {
      logger.debug('subscribe: graph-updated payload missing fields', payload);
      return;
    }
    callback({ kind: 'graph-updated', signature: payload.signature, ts: payload.ts });
    return;
  }
  if (msg.event === 'error') {
    let payload: { error?: unknown };
    try {
      payload = JSON.parse(msg.data) as { error?: unknown };
    } catch {
      payload = { error: msg.data };
    }
    const error = typeof payload.error === 'string' ? payload.error : 'unknown error';
    callback({ kind: 'error', error });
  }
  // Unknown event kinds — ignore.
}
