/**
 * IPC Handlers for the Neo4j knowledge graph subsystem.
 *
 * The renderer never speaks HTTP. These handlers proxy renderer calls to the
 * locally-spawned Python FastAPI server (`daddy_agent.viz`) via two
 * collaborators behind narrow contracts:
 *   - `IPythonVizServer` — owns the OS-level subprocess (start/stop/health).
 *   - `IKnowledgeGraphProxy` — speaks HTTP to that subprocess.
 *
 * Channels:
 *   - knowledgeGraph:query      — fetch a graph (summary or detail view)
 *   - knowledgeGraph:search     — substring search across name/path
 *   - knowledgeGraph:neighbors  — expand neighbors around a node (1..3 hops)
 *   - knowledgeGraph:getHealth  — health snapshot of sidecar + driver
 *   - knowledgeGraph:start      — start the Python sidecar (idempotent)
 *   - knowledgeGraph:stop       — stop the Python sidecar (idempotent)
 *   - knowledgeGraph:event      — push channel (main → renderer) carrying
 *                                 normalized SSE events from `/events`
 */

import {
  KNOWLEDGE_GRAPH_EVENT,
  KNOWLEDGE_GRAPH_GET_HEALTH,
  KNOWLEDGE_GRAPH_NEIGHBORS,
  KNOWLEDGE_GRAPH_QUERY,
  KNOWLEDGE_GRAPH_SEARCH,
  KNOWLEDGE_GRAPH_START,
  KNOWLEDGE_GRAPH_STOP,
  // eslint-disable-next-line boundaries/element-types -- IPC channel constants are shared between main and preload by design
} from '@preload/constants/ipcChannels';
import {
  KG_ALLOWED_NODE_LABELS,
  type KGEvent,
  type KGGraphRequest,
  type KGGraphResponse,
  type KGHealth,
  type KGNeighborsRequest,
  type KGNeighborsResponse,
  type KGNodeLabel,
  type KGSearchRequest,
  type KGSearchResponse,
} from '@shared/types/knowledgeGraph';
import { createLogger } from '@shared/utils/logger';
import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron';

import type { IKnowledgeGraphProxy, IPythonVizServer } from '../services/knowledgeGraph/types';
import type { IpcResult } from '@shared/types/ipc';

const logger = createLogger('IPC:knowledgeGraph');

// =============================================================================
// Validation
// =============================================================================

interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  error?: string;
}

const KG_MAX_LIMIT = 20000;
const KG_MIN_DEPTH = 1;
const KG_MAX_DEPTH = 3;
const KG_SEARCH_MAX_QUERY = 512;

const KG_ALLOWED_NODE_LABEL_SET = new Set<string>(KG_ALLOWED_NODE_LABELS);

function validatePositiveIntInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number
): ValidationResult<number> {
  if (value === undefined || value === null) {
    return { valid: true, value: undefined };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }
  if (value < min || value > max) {
    return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
  }
  return { valid: true, value };
}

function validateNonEmptyString(
  value: unknown,
  fieldName: string,
  maxLength: number
): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }
  if (trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds max length (${maxLength})` };
  }
  return { valid: true, value: trimmed };
}

function validateKgNodeLabel(value: unknown): ValidationResult<KGNodeLabel | undefined> {
  if (value === undefined || value === null) {
    return { valid: true, value: undefined };
  }
  if (typeof value !== 'string' || !KG_ALLOWED_NODE_LABEL_SET.has(value)) {
    return {
      valid: false,
      error: `type must be one of: ${KG_ALLOWED_NODE_LABELS.join(', ')}`,
    };
  }
  return { valid: true, value: value as KGNodeLabel };
}

export function validateKgGraphRequest(raw: unknown): ValidationResult<KGGraphRequest | undefined> {
  if (raw === undefined || raw === null) {
    return { valid: true, value: undefined };
  }
  if (typeof raw !== 'object') {
    return { valid: false, error: 'request must be an object' };
  }
  const req = raw as Record<string, unknown>;

  const typeCheck = validateKgNodeLabel(req.type);
  if (!typeCheck.valid) {
    return { valid: false, error: typeCheck.error };
  }

  const limitCheck = validatePositiveIntInRange(req.limit, 'limit', 1, KG_MAX_LIMIT);
  if (!limitCheck.valid) {
    return { valid: false, error: limitCheck.error };
  }

  return { valid: true, value: raw as KGGraphRequest };
}

export function validateKgSearchRequest(raw: unknown): ValidationResult<KGSearchRequest> {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'request must be an object' };
  }
  const req = raw as Record<string, unknown>;

  const qCheck = validateNonEmptyString(req.q, 'q', KG_SEARCH_MAX_QUERY);
  if (!qCheck.valid) {
    return { valid: false, error: qCheck.error };
  }

  const limitCheck = validatePositiveIntInRange(req.limit, 'limit', 1, KG_MAX_LIMIT);
  if (!limitCheck.valid) {
    return { valid: false, error: limitCheck.error };
  }

  return { valid: true, value: { ...(raw as KGSearchRequest), q: qCheck.value! } };
}

export function validateKgNeighborsRequest(raw: unknown): ValidationResult<KGNeighborsRequest> {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'request must be an object' };
  }
  const req = raw as Record<string, unknown>;

  const idCheck = validateNonEmptyString(req.nodeId, 'nodeId', 512);
  if (!idCheck.valid) {
    return { valid: false, error: idCheck.error };
  }

  const depthCheck = validatePositiveIntInRange(req.depth, 'depth', KG_MIN_DEPTH, KG_MAX_DEPTH);
  if (!depthCheck.valid) {
    return { valid: false, error: depthCheck.error };
  }

  return {
    valid: true,
    value: { ...(raw as KGNeighborsRequest), nodeId: idCheck.value! },
  };
}

// =============================================================================
// Module state
// =============================================================================

let pythonServer: IPythonVizServer | null = null;
let kgProxy: IKnowledgeGraphProxy | null = null;
let unsubscribeFromProxy: (() => void) | null = null;

/**
 * Initializes knowledge-graph handlers with the lifecycle and proxy services.
 * Must be called before `registerKnowledgeGraphHandlers`.
 */
export function initializeKnowledgeGraphHandlers(
  server: IPythonVizServer,
  proxy: IKnowledgeGraphProxy
): void {
  pythonServer = server;
  kgProxy = proxy;
}

function getServer(): IPythonVizServer {
  if (!pythonServer) {
    throw new Error('Knowledge graph server is not initialized');
  }
  return pythonServer;
}

function getProxy(): IKnowledgeGraphProxy {
  if (!kgProxy) {
    throw new Error('Knowledge graph proxy is not initialized');
  }
  return kgProxy;
}

async function wrapKgHandler<T>(operation: string, run: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    const data = await run();
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[knowledgeGraph:${operation}] ${message}`);
    return { success: false, error: message };
  }
}

// =============================================================================
// Handlers
// =============================================================================

async function handleQuery(
  _event: IpcMainInvokeEvent,
  request?: unknown
): Promise<IpcResult<KGGraphResponse>> {
  const validation = validateKgGraphRequest(request);
  if (!validation.valid) {
    return { success: false, error: validation.error ?? 'Invalid query request' };
  }
  return wrapKgHandler('query', () => getProxy().query(validation.value));
}

async function handleSearch(
  _event: IpcMainInvokeEvent,
  request: unknown
): Promise<IpcResult<KGSearchResponse>> {
  const validation = validateKgSearchRequest(request);
  if (!validation.valid) {
    return { success: false, error: validation.error ?? 'Invalid search request' };
  }
  return wrapKgHandler('search', () => getProxy().search(validation.value!));
}

async function handleNeighbors(
  _event: IpcMainInvokeEvent,
  request: unknown
): Promise<IpcResult<KGNeighborsResponse>> {
  const validation = validateKgNeighborsRequest(request);
  if (!validation.valid) {
    return { success: false, error: validation.error ?? 'Invalid neighbors request' };
  }
  return wrapKgHandler('neighbors', () => getProxy().neighbors(validation.value!));
}

async function handleGetHealth(): Promise<IpcResult<KGHealth>> {
  return wrapKgHandler('getHealth', () => getServer().getHealth());
}

async function handleStart(): Promise<IpcResult<KGHealth>> {
  return wrapKgHandler('start', () => getServer().start());
}

async function handleStop(): Promise<IpcResult<KGHealth>> {
  return wrapKgHandler('stop', () => getServer().stop());
}

// =============================================================================
// Event fan-out (main → renderer)
// =============================================================================

function broadcastKgEvent(event: KGEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(KNOWLEDGE_GRAPH_EVENT, event);
    }
  }
}

// =============================================================================
// Lifecycle
// =============================================================================

export function registerKnowledgeGraphHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(KNOWLEDGE_GRAPH_QUERY, handleQuery);
  ipcMain.handle(KNOWLEDGE_GRAPH_SEARCH, handleSearch);
  ipcMain.handle(KNOWLEDGE_GRAPH_NEIGHBORS, handleNeighbors);
  ipcMain.handle(KNOWLEDGE_GRAPH_GET_HEALTH, handleGetHealth);
  ipcMain.handle(KNOWLEDGE_GRAPH_START, handleStart);
  ipcMain.handle(KNOWLEDGE_GRAPH_STOP, handleStop);

  // Subscribe once; the proxy decides when to actually open the SSE stream.
  if (kgProxy && !unsubscribeFromProxy) {
    unsubscribeFromProxy = kgProxy.subscribe(broadcastKgEvent);
  }

  logger.info('Knowledge graph handlers registered');
}

export function removeKnowledgeGraphHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler(KNOWLEDGE_GRAPH_QUERY);
  ipcMain.removeHandler(KNOWLEDGE_GRAPH_SEARCH);
  ipcMain.removeHandler(KNOWLEDGE_GRAPH_NEIGHBORS);
  ipcMain.removeHandler(KNOWLEDGE_GRAPH_GET_HEALTH);
  ipcMain.removeHandler(KNOWLEDGE_GRAPH_START);
  ipcMain.removeHandler(KNOWLEDGE_GRAPH_STOP);

  if (unsubscribeFromProxy) {
    try {
      unsubscribeFromProxy();
    } catch (error) {
      logger.error(
        `Failed to unsubscribe from KG proxy: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    unsubscribeFromProxy = null;
  }

  logger.info('Knowledge graph handlers removed');
}
