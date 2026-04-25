import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  KGEvent,
  KGGraphResponse,
  KGHealth,
  KGNeighborsResponse,
  KGSearchResponse,
} from '@shared/types/knowledgeGraph';

vi.mock('@shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { mockGetAllWindows } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn(() => [] as unknown[]),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows },
}));

vi.mock('@preload/constants/ipcChannels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@preload/constants/ipcChannels')>();
  return { ...actual };
});

import {
  KNOWLEDGE_GRAPH_EVENT,
  KNOWLEDGE_GRAPH_GET_HEALTH,
  KNOWLEDGE_GRAPH_NEIGHBORS,
  KNOWLEDGE_GRAPH_QUERY,
  KNOWLEDGE_GRAPH_SEARCH,
  KNOWLEDGE_GRAPH_START,
  KNOWLEDGE_GRAPH_STOP,
} from '@preload/constants/ipcChannels';
import {
  initializeKnowledgeGraphHandlers,
  registerKnowledgeGraphHandlers,
  removeKnowledgeGraphHandlers,
} from '@main/ipc/knowledgeGraph';
import type {
  IKnowledgeGraphProxy,
  IPythonVizServer,
} from '@main/services/knowledgeGraph/types';

function createMockIpcMain() {
  return {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  };
}

function createFakeServer(): IPythonVizServer & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getHealth: ReturnType<typeof vi.fn>;
  baseUrl: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
} {
  const stoppedHealth: KGHealth = {
    serverStatus: 'stopped',
    neo4jStatus: 'unknown',
    port: null,
    pid: null,
    lastError: null,
  };
  return {
    start: vi.fn().mockResolvedValue(stoppedHealth),
    stop: vi.fn().mockResolvedValue(stoppedHealth),
    getHealth: vi.fn().mockResolvedValue(stoppedHealth),
    baseUrl: vi.fn().mockReturnValue('http://localhost:9750'),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createFakeProxy(): IKnowledgeGraphProxy & {
  query: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  neighbors: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  __captureCallback: () => ((event: KGEvent) => void) | null;
  __unsubscribe: ReturnType<typeof vi.fn>;
} {
  let capturedCallback: ((event: KGEvent) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    query: vi.fn().mockResolvedValue({ nodes: [], edges: [], view: 'summary' } as KGGraphResponse),
    search: vi.fn().mockResolvedValue({ results: [] } as KGSearchResponse),
    neighbors: vi.fn().mockResolvedValue({ nodes: [], edges: [] } as KGNeighborsResponse),
    subscribe: vi.fn((callback: (event: KGEvent) => void) => {
      capturedCallback = callback;
      return unsubscribe;
    }),
    __captureCallback: () => capturedCallback,
    __unsubscribe: unsubscribe,
  };
}

function getHandler(
  ipc: ReturnType<typeof createMockIpcMain>,
  channel: string
): (event: unknown, ...args: unknown[]) => unknown {
  const entry = ipc.handle.mock.calls.find((call) => call[0] === channel);
  if (!entry) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  return entry[1] as (event: unknown, ...args: unknown[]) => unknown;
}

describe('knowledgeGraph IPC handlers', () => {
  let ipc: ReturnType<typeof createMockIpcMain>;
  let server: ReturnType<typeof createFakeServer>;
  let proxy: ReturnType<typeof createFakeProxy>;

  beforeEach(() => {
    ipc = createMockIpcMain();
    server = createFakeServer();
    proxy = createFakeProxy();
    mockGetAllWindows.mockReturnValue([]);
    initializeKnowledgeGraphHandlers(server, proxy);
  });

  afterEach(() => {
    // Reset module-level subscription so each test starts clean
    removeKnowledgeGraphHandlers(ipc as never);
  });

  it('registers all 6 invoke channels', () => {
    registerKnowledgeGraphHandlers(ipc as never);

    expect(ipc.handle).toHaveBeenCalledTimes(6);
    expect(ipc.handle).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_QUERY, expect.any(Function));
    expect(ipc.handle).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_SEARCH, expect.any(Function));
    expect(ipc.handle).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_NEIGHBORS, expect.any(Function));
    expect(ipc.handle).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_GET_HEALTH, expect.any(Function));
    expect(ipc.handle).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_START, expect.any(Function));
    expect(ipc.handle).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_STOP, expect.any(Function));
  });

  it('removes all 6 handlers and unsubscribes from proxy events', () => {
    registerKnowledgeGraphHandlers(ipc as never);
    removeKnowledgeGraphHandlers(ipc as never);

    expect(ipc.removeHandler).toHaveBeenCalledTimes(6);
    expect(ipc.removeHandler).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_QUERY);
    expect(ipc.removeHandler).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_SEARCH);
    expect(ipc.removeHandler).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_NEIGHBORS);
    expect(ipc.removeHandler).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_GET_HEALTH);
    expect(ipc.removeHandler).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_START);
    expect(ipc.removeHandler).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_STOP);
    expect(proxy.__unsubscribe).toHaveBeenCalledTimes(1);
  });

  describe('query', () => {
    it('forwards a valid request and returns success envelope', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_QUERY);
      const expected: KGGraphResponse = {
        nodes: [{ id: 'n1', label: 'a', type: 'File', labels: ['File'], community: null, attributes: {}, size: 1, degree: 0 }],
        edges: [],
        view: 'detail',
      };
      proxy.query.mockResolvedValueOnce(expected);

      const result = await handler({}, { db: 'codebase', view: 'detail', type: 'File', limit: 100 });

      expect(result).toEqual({ success: true, data: expected });
      expect(proxy.query).toHaveBeenCalledWith({
        db: 'codebase',
        view: 'detail',
        type: 'File',
        limit: 100,
      });
    });

    it('forwards undefined when called with no request', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_QUERY);

      const result = await handler({});

      expect(result).toEqual({
        success: true,
        data: { nodes: [], edges: [], view: 'summary' },
      });
      expect(proxy.query).toHaveBeenCalledWith(undefined);
    });

    it('rejects an unknown node type without calling proxy', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_QUERY);

      const result = await handler({}, { type: 'NotARealLabel' });

      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toMatch(/type must be one of/);
      expect(proxy.query).not.toHaveBeenCalled();
    });

    it('rejects out-of-range limit', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_QUERY);

      const result = await handler({}, { limit: 99999 });

      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toMatch(/limit/);
      expect(proxy.query).not.toHaveBeenCalled();
    });

    it('rejects non-integer limit', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_QUERY);

      const result = await handler({}, { limit: 1.5 });

      expect(result).toMatchObject({ success: false });
      expect(proxy.query).not.toHaveBeenCalled();
    });

    it('returns error envelope when proxy throws', async () => {
      proxy.query.mockRejectedValueOnce(new Error('Proxy unreachable'));
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_QUERY);

      const result = await handler({}, {});

      expect(result).toEqual({ success: false, error: 'Proxy unreachable' });
    });
  });

  describe('search', () => {
    it('forwards a valid request', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_SEARCH);
      const expected: KGSearchResponse = { results: [] };
      proxy.search.mockResolvedValueOnce(expected);

      const result = await handler({}, { q: '  hello  ', limit: 50 });

      expect(result).toEqual({ success: true, data: expected });
      // Trimmed query
      expect(proxy.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'hello', limit: 50 }));
    });

    it('rejects empty/whitespace query', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_SEARCH);

      const result = await handler({}, { q: '   ' });

      expect(result).toMatchObject({ success: false });
      expect(proxy.search).not.toHaveBeenCalled();
    });

    it('rejects non-string q', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_SEARCH);

      const result = await handler({}, { q: 42 });

      expect(result).toMatchObject({ success: false });
      expect(proxy.search).not.toHaveBeenCalled();
    });

    it('rejects null request', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_SEARCH);

      const result = await handler({}, null);

      expect(result).toMatchObject({ success: false });
    });
  });

  describe('neighbors', () => {
    it('forwards a valid request', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_NEIGHBORS);
      const expected: KGNeighborsResponse = { nodes: [], edges: [] };
      proxy.neighbors.mockResolvedValueOnce(expected);

      const result = await handler({}, { nodeId: 'abc-123', depth: 2 });

      expect(result).toEqual({ success: true, data: expected });
      expect(proxy.neighbors).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'abc-123', depth: 2 })
      );
    });

    it('rejects empty nodeId', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_NEIGHBORS);

      const result = await handler({}, { nodeId: '' });

      expect(result).toMatchObject({ success: false });
      expect(proxy.neighbors).not.toHaveBeenCalled();
    });

    it('rejects depth=0', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_NEIGHBORS);

      const result = await handler({}, { nodeId: 'a', depth: 0 });

      expect(result).toMatchObject({ success: false });
      expect(proxy.neighbors).not.toHaveBeenCalled();
    });

    it('rejects depth=4 (max is 3)', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_NEIGHBORS);

      const result = await handler({}, { nodeId: 'a', depth: 4 });

      expect(result).toMatchObject({ success: false });
      expect(proxy.neighbors).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle handlers', () => {
    it('getHealth delegates to server', async () => {
      const expected: KGHealth = {
        serverStatus: 'running',
        neo4jStatus: 'reachable',
        port: 9750,
        pid: 4242,
        lastError: null,
      };
      server.getHealth.mockResolvedValueOnce(expected);
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_GET_HEALTH);

      const result = await handler({});

      expect(result).toEqual({ success: true, data: expected });
      expect(server.getHealth).toHaveBeenCalledTimes(1);
    });

    it('start delegates to server', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_START);

      const result = await handler({});

      expect(result).toMatchObject({ success: true });
      expect(server.start).toHaveBeenCalledTimes(1);
    });

    it('stop delegates to server', async () => {
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_STOP);

      const result = await handler({});

      expect(result).toMatchObject({ success: true });
      expect(server.stop).toHaveBeenCalledTimes(1);
    });

    it('returns error envelope when server.start throws', async () => {
      server.start.mockRejectedValueOnce(new Error('python missing'));
      registerKnowledgeGraphHandlers(ipc as never);
      const handler = getHandler(ipc, KNOWLEDGE_GRAPH_START);

      const result = await handler({});

      expect(result).toEqual({ success: false, error: 'python missing' });
    });
  });

  describe('event fan-out', () => {
    it('subscribes to proxy events on register', () => {
      registerKnowledgeGraphHandlers(ipc as never);
      expect(proxy.subscribe).toHaveBeenCalledTimes(1);
    });

    it('forwards proxy events to every BrowserWindow webContents', () => {
      const sendA = vi.fn();
      const sendB = vi.fn();
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => false, webContents: { send: sendA } },
        { isDestroyed: () => false, webContents: { send: sendB } },
      ]);

      registerKnowledgeGraphHandlers(ipc as never);
      const callback = proxy.__captureCallback();
      expect(callback).toBeTypeOf('function');

      const event: KGEvent = { kind: 'graph-updated', signature: 'sig-1', ts: 12345 };
      callback!(event);

      expect(sendA).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_EVENT, event);
      expect(sendB).toHaveBeenCalledWith(KNOWLEDGE_GRAPH_EVENT, event);
    });

    it('skips destroyed windows', () => {
      const sendAlive = vi.fn();
      const sendDead = vi.fn();
      mockGetAllWindows.mockReturnValue([
        { isDestroyed: () => true, webContents: { send: sendDead } },
        { isDestroyed: () => false, webContents: { send: sendAlive } },
      ]);

      registerKnowledgeGraphHandlers(ipc as never);
      const callback = proxy.__captureCallback();
      callback!({ kind: 'connection', connected: true });

      expect(sendDead).not.toHaveBeenCalled();
      expect(sendAlive).toHaveBeenCalledTimes(1);
    });
  });
});
