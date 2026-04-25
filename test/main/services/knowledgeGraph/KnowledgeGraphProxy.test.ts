/**
 * Unit tests for KnowledgeGraphProxy.
 *
 * The proxy depends on:
 *   - global `fetch` — stubbed via vi.stubGlobal
 *   - `IPythonVizServer` — stubbed with a minimal object exposing baseUrl()
 *
 * SSE tests construct ReadableStreams that emit pre-encoded text-event-stream
 * frames and assert callback invocations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeGraphProxy } from '@main/services/knowledgeGraph/KnowledgeGraphProxy';
import type { IPythonVizServer } from '@main/services/knowledgeGraph/types';
import type { KGEvent } from '@shared/types/knowledgeGraph';

const BASE_URL = 'http://localhost:9750';

function makeServer(baseUrl: string = BASE_URL): IPythonVizServer {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getHealth: vi.fn(),
    baseUrl: vi.fn(() => baseUrl),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IPythonVizServer;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** Pump the microtask queue a few times so awaited fetches/streams resolve. */
async function flushAsync(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('KnowledgeGraphProxy', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ----------------------------------------------------------------------
  // query()
  // ----------------------------------------------------------------------

  describe('query', () => {
    it('hits /api/graph with no query string when called with no args', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ nodes: [], edges: [], view: 'summary' }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.query();

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/graph`);
    });

    it('serialises db/view/limit/type to a query string in order', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ nodes: [], edges: [], view: 'detail' }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.query({ db: 'memory', view: 'detail', limit: 50, type: 'Function' });

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      // Compare via parsed URL so ordering doesn't matter as long as values are right.
      const url = new URL(calledUrl);
      expect(url.pathname).toBe('/api/graph');
      expect(url.searchParams.get('db')).toBe('memory');
      expect(url.searchParams.get('view')).toBe('detail');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.get('type')).toBe('Function');
    });

    it('maps hubThreshold to snake_case hub_threshold', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ nodes: [], edges: [], view: 'summary' }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.query({ hubThreshold: 5 });

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.searchParams.get('hub_threshold')).toBe('5');
      expect(url.searchParams.has('hubThreshold')).toBe(false);
    });

    it('skips undefined params', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ nodes: [], edges: [], view: 'summary' }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.query({ db: 'codebase' });

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.searchParams.get('db')).toBe('codebase');
      // No view, limit, type, etc.
      expect(Array.from(url.searchParams.keys())).toEqual(['db']);
    });

    it('throws "unreachable" when fetch rejects (network error)', async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      );
      const proxy = new KnowledgeGraphProxy(makeServer());

      await expect(proxy.query()).rejects.toThrow(/unreachable/i);
    });

    it('throws "KG <status>: <error>" on 4xx with JSON error body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unknown node label: Cat' }, 400));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await expect(proxy.query()).rejects.toThrow('KG 400: unknown node label: Cat');
    });

    it('throws when response is shape-invalid (no nodes array)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ edges: [], view: 'summary' }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await expect(proxy.query()).rejects.toThrow(/nodes\/edges/);
    });

    it('reads baseUrl() per call (does not cache)', async () => {
      // A fresh Response per call — Response bodies are single-use, so a
      // shared instance would fail the second read.
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ nodes: [], edges: [], view: 'summary' }))
      );
      const server = makeServer();
      let port = 9750;
      (server.baseUrl as ReturnType<typeof vi.fn>).mockImplementation(() => `http://localhost:${port}`);
      const proxy = new KnowledgeGraphProxy(server);

      await proxy.query();
      port = 9760;
      await proxy.query();

      expect(fetchMock.mock.calls[0][0]).toContain('localhost:9750');
      expect(fetchMock.mock.calls[1][0]).toContain('localhost:9760');
    });
  });

  // ----------------------------------------------------------------------
  // search()
  // ----------------------------------------------------------------------

  describe('search', () => {
    it('hits /api/search with the q parameter', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.search({ q: 'auth' });

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.pathname).toBe('/api/search');
      expect(url.searchParams.get('q')).toBe('auth');
    });

    it('passes db and limit when provided', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.search({ q: 'auth', db: 'codebase', limit: 25 });

      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.get('q')).toBe('auth');
      expect(url.searchParams.get('db')).toBe('codebase');
      expect(url.searchParams.get('limit')).toBe('25');
    });

    it('throws when results is not an array', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ results: 'oops' }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await expect(proxy.search({ q: 'auth' })).rejects.toThrow(/results not array/);
    });
  });

  // ----------------------------------------------------------------------
  // neighbors()
  // ----------------------------------------------------------------------

  describe('neighbors', () => {
    it('puts nodeId in the path and depth in the query', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ nodes: [], edges: [] }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await proxy.neighbors({ nodeId: 'n:1', depth: 2 });

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      // n:1 → encoded as n%3A1
      expect(calledUrl).toContain('/api/node/n%3A1/neighbors');
      const url = new URL(calledUrl);
      expect(url.searchParams.get('depth')).toBe('2');
    });

    it('throws on shape-invalid response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ nodes: [] /* no edges */ }));
      const proxy = new KnowledgeGraphProxy(makeServer());

      await expect(proxy.neighbors({ nodeId: 'n:1' })).rejects.toThrow(/nodes\/edges/);
    });
  });

  // ----------------------------------------------------------------------
  // subscribe() — SSE
  // ----------------------------------------------------------------------

  describe('subscribe', () => {
    it('parses event: graph-updated into a graph-updated KGEvent', async () => {
      fetchMock.mockResolvedValueOnce(
        streamResponse([
          'event: graph-updated\ndata: {"signature":"x","ts":1}\n\n',
        ])
      );
      const events: KGEvent[] = [];
      const proxy = new KnowledgeGraphProxy(makeServer());
      // Prevent the test from triggering reconnect after stream end.
      vi.useFakeTimers();

      const unsubscribe = proxy.subscribe((e) => events.push(e));
      // Let fetch resolve and stream drain.
      await flushAsync(20);
      unsubscribe();

      // Should have at least: connection true → graph-updated → (connection false on stream close)
      expect(events).toEqual(
        expect.arrayContaining([
          { kind: 'connection', connected: true },
          { kind: 'graph-updated', signature: 'x', ts: 1 },
        ])
      );
    });

    it('drops heartbeat lines (": heartbeat N\\n\\n")', async () => {
      fetchMock.mockResolvedValueOnce(
        streamResponse([
          ': heartbeat 1\n\n',
          ': heartbeat 2\n\n',
          'event: graph-updated\ndata: {"signature":"y","ts":2}\n\n',
        ])
      );
      const events: KGEvent[] = [];
      const proxy = new KnowledgeGraphProxy(makeServer());
      vi.useFakeTimers();

      const unsubscribe = proxy.subscribe((e) => events.push(e));
      await flushAsync(20);
      unsubscribe();

      const graphUpdates = events.filter((e) => e.kind === 'graph-updated');
      expect(graphUpdates).toEqual([{ kind: 'graph-updated', signature: 'y', ts: 2 }]);
      // No event should have been derived from a heartbeat line.
      // (We assert this implicitly by the absence of any unexpected entries.)
    });

    it('parses event: error into an error KGEvent', async () => {
      fetchMock.mockResolvedValueOnce(
        streamResponse([
          'event: error\ndata: {"error":"db down"}\n\n',
        ])
      );
      const events: KGEvent[] = [];
      const proxy = new KnowledgeGraphProxy(makeServer());
      vi.useFakeTimers();

      const unsubscribe = proxy.subscribe((e) => events.push(e));
      await flushAsync(20);
      unsubscribe();

      expect(events).toEqual(
        expect.arrayContaining([{ kind: 'error', error: 'db down' }])
      );
    });

    it('emits connection: true on open', async () => {
      fetchMock.mockResolvedValueOnce(streamResponse(['']));
      const events: KGEvent[] = [];
      const proxy = new KnowledgeGraphProxy(makeServer());
      vi.useFakeTimers();

      const unsubscribe = proxy.subscribe((e) => events.push(e));
      await flushAsync(20);
      unsubscribe();

      expect(events[0]).toEqual({ kind: 'connection', connected: true });
    });

    it('returned unsubscribe fn aborts the in-flight fetch', async () => {
      // Capture the AbortSignal handed to fetch.
      let capturedSignal: AbortSignal | undefined;
      // Build a stream that never closes, so the proxy is stuck reading.
      const neverEnding = new ReadableStream<Uint8Array>({
        start(_controller) {
          // never enqueue or close
        },
      });
      fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return Promise.resolve(
          new Response(neverEnding, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        );
      });
      const proxy = new KnowledgeGraphProxy(makeServer());
      vi.useFakeTimers();

      const unsubscribe = proxy.subscribe(() => {});
      await flushAsync(10);

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      unsubscribe();

      expect(capturedSignal?.aborted).toBe(true);
    });

    it('does not reconnect after unsubscribe', async () => {
      // First fetch: stream that closes immediately. Without unsubscribe the
      // proxy would schedule a reconnect — unsubscribing first should cancel it.
      fetchMock.mockResolvedValueOnce(streamResponse([]));
      const proxy = new KnowledgeGraphProxy(makeServer());
      vi.useFakeTimers();

      const unsubscribe = proxy.subscribe(() => {});
      await flushAsync(20);
      unsubscribe();

      // Advance past the reconnect window — no second fetch should fire.
      vi.advanceTimersByTime(60_000);
      await flushAsync(5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
