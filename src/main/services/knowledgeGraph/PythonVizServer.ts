/**
 * PythonVizServer — manages the lifecycle of the `daddy_agent.viz` FastAPI
 * sidecar that exposes the Neo4j knowledge graph over local HTTP.
 *
 * Responsibilities:
 *   - Spawn `<pythonBin> -m daddy_agent.viz --host <host> --port <port>` as a
 *     managed child process.
 *   - Drive a small state machine (stopped → starting → running → crashed,
 *     plus stop()).
 *   - Poll `/healthz` until the server is reachable; classify Neo4j status
 *     based on 200 vs 503.
 *   - Surface stderr lines as events and retain the last 50 lines for crash
 *     diagnostics.
 *   - Provide a typed EventEmitter API matching `PythonVizServerEventMap`.
 *
 * Auto-restart is intentionally NOT in scope — that's the job of whatever
 * orchestrates this service.
 */

import { spawn, type ChildProcessByStdio } from 'child_process';
import { EventEmitter } from 'events';
import type { Readable } from 'stream';

import { createLogger } from '@shared/utils/logger';
import type {
  KGHealth,
  KGNeo4jStatus,
  KGServerStatus,
} from '@shared/types/knowledgeGraph';

import type {
  IPythonVizServer,
  PythonVizServerEventMap,
  PythonVizServerOptions,
} from './types';

type SidecarChild = ChildProcessByStdio<null, Readable, Readable>;

const DEFAULT_PORT = 9750;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PYTHON_BIN = 'python3';
const READINESS_POLL_INTERVAL_MS = 250;
const READINESS_TIMEOUT_MS = 30_000;
const SIGTERM_GRACE_MS = 5_000;
const STDERR_BUFFER_LINES = 50;

/** Env vars from `process.env` that we always forward to the child. */
const NEO4J_PASSTHROUGH_KEYS = [
  'NEO4J_URI',
  'NEO4J_USER',
  'NEO4J_PASSWORD',
  'NEO4J_CODEBASE_DB',
  'NEO4J_MEMORY_DB',
] as const;

/**
 * Minimal injectable interface so tests can swap the readiness probe without
 * stubbing global fetch. The probe returns the HTTP status code or `null` when
 * the server is unreachable (connection refused, DNS failure, etc.).
 */
export interface ReadinessProbe {
  (url: string, signal: AbortSignal): Promise<number | null>;
}

/** Internal options surface — exposes test seams not on the public type. */
export interface PythonVizServerInternalOptions extends PythonVizServerOptions {
  /** Override readiness probe (tests). Defaults to `fetch` against /healthz. */
  probe?: ReadinessProbe;
  /** Override the readiness poll interval (tests). */
  pollIntervalMs?: number;
  /** Override the readiness timeout (tests). */
  readinessTimeoutMs?: number;
  /** Override the SIGTERM → SIGKILL grace window (tests). */
  sigtermGraceMs?: number;
}

const logger = createLogger('KG:PythonVizServer');

/** Default fetch-based probe. */
const defaultProbe: ReadinessProbe = async (url, signal) => {
  try {
    const response = await fetch(url, { signal });
    return response.status;
  } catch {
    return null;
  }
};

export class PythonVizServer extends EventEmitter implements IPythonVizServer {
  private readonly host: string;
  private readonly port: number;
  private readonly pythonBin: string;
  private readonly cwd: string | undefined;
  private readonly extraEnv: NodeJS.ProcessEnv;
  private readonly probe: ReadinessProbe;
  private readonly pollIntervalMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly sigtermGraceMs: number;

  private serverStatus: KGServerStatus = 'stopped';
  private neo4jStatus: KGNeo4jStatus = 'unknown';
  private child: SidecarChild | null = null;
  private pid: number | null = null;
  private lastError: string | null = null;
  private readonly stderrBuffer: string[] = [];
  private stderrCarry = '';

  /** In-flight start, so concurrent start() calls coalesce. */
  private startPromise: Promise<KGHealth> | null = null;
  /** In-flight stop, so concurrent stop() calls coalesce. */
  private stopPromise: Promise<KGHealth> | null = null;
  /** Resolved when the current child fully exits (used by stop()). */
  private exitPromise: Promise<void> | null = null;
  private resolveExit: (() => void) | null = null;
  /** Aborter for the readiness probe loop. */
  private readinessAbort: AbortController | null = null;

  constructor(options: PythonVizServerInternalOptions = {}) {
    super();
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.pythonBin = options.pythonBin ?? DEFAULT_PYTHON_BIN;
    this.cwd = options.cwd;
    this.extraEnv = options.env ?? {};
    this.probe = options.probe ?? defaultProbe;
    this.pollIntervalMs = options.pollIntervalMs ?? READINESS_POLL_INTERVAL_MS;
    this.readinessTimeoutMs =
      options.readinessTimeoutMs ?? READINESS_TIMEOUT_MS;
    this.sigtermGraceMs = options.sigtermGraceMs ?? SIGTERM_GRACE_MS;
  }

  // -- public API ----------------------------------------------------------

  async start(): Promise<KGHealth> {
    if (this.serverStatus === 'running') {
      return this.snapshot();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.runStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop(): Promise<KGHealth> {
    if (this.serverStatus === 'stopped' && !this.child) {
      return this.snapshot();
    }
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.runStop().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  async getHealth(): Promise<KGHealth> {
    return this.snapshot();
  }

  baseUrl(): string {
    if (this.serverStatus !== 'running') {
      throw new Error('PythonVizServer is not running');
    }
    return `http://${this.host}:${this.port}`;
  }

  override on<E extends keyof PythonVizServerEventMap>(
    event: E,
    listener: PythonVizServerEventMap[E]
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<E extends keyof PythonVizServerEventMap>(
    event: E,
    listener: PythonVizServerEventMap[E]
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  // -- internals -----------------------------------------------------------

  private snapshot(): KGHealth {
    return {
      serverStatus: this.serverStatus,
      neo4jStatus: this.neo4jStatus,
      port: this.child ? this.port : null,
      pid: this.pid,
      lastError: this.lastError,
    };
  }

  private async runStart(): Promise<KGHealth> {
    this.serverStatus = 'starting';
    this.neo4jStatus = 'unknown';
    this.lastError = null;
    this.stderrBuffer.length = 0;
    this.stderrCarry = '';

    const env = this.buildChildEnv();
    const args = [
      '-m',
      'daddy_agent.viz',
      '--host',
      this.host,
      '--port',
      String(this.port),
      '--log-level',
      'info',
    ];

    logger.info(
      `spawning ${this.pythonBin} ${args.join(' ')} (cwd=${this.cwd ?? process.cwd()})`
    );

    let child: SidecarChild;
    try {
      child = spawn(this.pythonBin, args, {
        cwd: this.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.serverStatus = 'crashed';
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.error('failed to spawn python sidecar', err);
      return this.snapshot();
    }

    this.child = child;
    this.pid = child.pid ?? null;
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });

    this.attachChildListeners(child);

    // Probe readiness; if the subprocess exits before we get a response we'll
    // observe it via the exit listener and abort this loop.
    const ready = await this.waitForReady();

    if (!ready) {
      // The exit listener may have flipped status to 'crashed' asynchronously
      // while we were awaiting waitForReady(); cast widens the field back to
      // the full union so TS doesn't keep the 'starting' literal we set above.
      // Either subprocess died, or readiness timed out. If it timed out and the
      // child is still alive, we kill it so the caller doesn't have to.
      if (this.child && (this.serverStatus as KGServerStatus) !== 'crashed') {
        this.lastError = this.lastError ?? 'readiness probe timed out';
        await this.killChild();
      }
      // killChild flips state to 'crashed' via the exit listener.
      if ((this.serverStatus as KGServerStatus) !== 'crashed') {
        this.serverStatus = 'crashed';
      }
      return this.snapshot();
    }

    this.serverStatus = 'running';
    this.emit('ready');
    return this.snapshot();
  }

  private async runStop(): Promise<KGHealth> {
    const child = this.child;
    if (!child) {
      this.serverStatus = 'stopped';
      return this.snapshot();
    }

    // Abort any in-flight readiness probing.
    this.readinessAbort?.abort();

    // Mark intent so the exit handler treats this as graceful, not a crash.
    const stoppingMarker = Symbol.for('PythonVizServer.stopping');
    (child as unknown as { [k: symbol]: boolean })[stoppingMarker] = true;

    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn('SIGTERM kill threw', err);
    }

    const exited = await this.waitForExit(this.sigtermGraceMs);
    if (!exited && this.child) {
      logger.warn('child did not exit after SIGTERM; sending SIGKILL');
      try {
        this.child.kill('SIGKILL');
      } catch (err) {
        logger.warn('SIGKILL threw', err);
      }
      await this.waitForExit(this.sigtermGraceMs);
    }

    this.serverStatus = 'stopped';
    return this.snapshot();
  }

  /** Returns true if the child exited within `timeoutMs`. */
  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (!this.exitPromise) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      this.exitPromise!.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private async killChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn('killChild SIGTERM threw', err);
    }
    const exited = await this.waitForExit(this.sigtermGraceMs);
    if (!exited && this.child) {
      try {
        this.child.kill('SIGKILL');
      } catch (err) {
        logger.warn('killChild SIGKILL threw', err);
      }
      await this.waitForExit(this.sigtermGraceMs);
    }
  }

  /**
   * Polls /healthz until success, subprocess exit, or timeout. Resolves true
   * on success, false otherwise. Also sets `neo4jStatus`.
   */
  private async waitForReady(): Promise<boolean> {
    const url = `http://${this.host}:${this.port}/healthz`;
    const deadline = Date.now() + this.readinessTimeoutMs;
    const aborter = new AbortController();
    this.readinessAbort = aborter;

    try {
      while (Date.now() < deadline) {
        if (aborter.signal.aborted) return false;
        if (!this.child) return false;
        if (this.serverStatus === 'crashed') return false;

        const status = await this.probe(url, aborter.signal);
        if (status === 200) {
          this.neo4jStatus = 'reachable';
          return true;
        }
        if (status === 503) {
          this.neo4jStatus = 'unreachable';
          return true;
        }
        // Any other HTTP response also counts as the server being up — but we
        // don't make assumptions about Neo4j reachability in that case.
        if (typeof status === 'number') {
          this.neo4jStatus = 'unknown';
          return true;
        }

        await this.sleep(this.pollIntervalMs, aborter.signal);
      }
    } catch (err) {
      // Aborted via stop() or child exit.
      if ((err as { name?: string }).name !== 'AbortError') {
        logger.warn('readiness probe loop threw', err);
      }
      return false;
    } finally {
      this.readinessAbort = null;
    }

    this.lastError = `readiness probe timed out after ${this.readinessTimeoutMs}ms`;
    return false;
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort);
    });
  }

  private buildChildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    // Inherit just enough of the parent env to find python on PATH and to
    // give the subprocess a sensible HOME / locale. We deliberately do NOT
    // forward the rest of process.env so unrelated Electron vars don't leak in.
    const passthroughKeys = [
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'LANG',
      'LC_ALL',
      'LC_CTYPE',
      'TMPDIR',
      'TEMP',
      'TMP',
      'PYTHONPATH',
      'PYTHONHOME',
      'SystemRoot', // Windows
      'SYSTEMROOT',
      'APPDATA',
      'LOCALAPPDATA',
      'USERPROFILE',
    ];
    for (const key of passthroughKeys) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    for (const key of NEO4J_PASSTHROUGH_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    // Caller overrides win.
    for (const [key, value] of Object.entries(this.extraEnv)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }

  private attachChildListeners(child: SidecarChild): void {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stderr.on('data', (chunk: string) => {
      this.handleStderrChunk(chunk);
    });

    child.stdout.on('data', (chunk: string) => {
      // We don't expect much on stdout (uvicorn logs to stderr by default),
      // but we keep the stream drained so the child doesn't block.
      logger.debug('viz stdout:', chunk.trimEnd());
    });

    child.on('error', (err) => {
      this.lastError = err.message;
      logger.error('child error', err);
    });

    child.on('exit', (code, signal) => {
      this.handleChildExit(child, code, signal);
    });
  }

  private handleStderrChunk(chunk: string): void {
    const combined = this.stderrCarry + chunk;
    const lines = combined.split(/\r?\n/);
    this.stderrCarry = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      this.recordStderrLine(line);
    }
  }

  private recordStderrLine(line: string): void {
    this.stderrBuffer.push(line);
    if (this.stderrBuffer.length > STDERR_BUFFER_LINES) {
      this.stderrBuffer.splice(
        0,
        this.stderrBuffer.length - STDERR_BUFFER_LINES
      );
    }
    this.emit('stderr', line);
  }

  private handleChildExit(
    child: SidecarChild,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    // Flush any remaining buffered stderr line.
    if (this.stderrCarry.length > 0) {
      this.recordStderrLine(this.stderrCarry);
      this.stderrCarry = '';
    }

    const stoppingMarker = Symbol.for('PythonVizServer.stopping');
    const wasStopping = Boolean(
      (child as unknown as { [k: symbol]: boolean })[stoppingMarker]
    );

    const previousStatus = this.serverStatus;
    this.child = null;
    this.pid = null;

    // Cancel any in-flight readiness probe.
    this.readinessAbort?.abort();

    if (wasStopping) {
      this.serverStatus = 'stopped';
    } else if (
      previousStatus === 'starting' ||
      previousStatus === 'running'
    ) {
      this.serverStatus = 'crashed';
      const tail = this.stderrBuffer.slice(-STDERR_BUFFER_LINES).join('\n');
      const reason = signal
        ? `signal ${signal}`
        : `exit code ${code ?? 'null'}`;
      this.lastError = tail
        ? `Python sidecar exited (${reason}):\n${tail}`
        : `Python sidecar exited (${reason})`;
    }

    this.resolveExit?.();
    this.resolveExit = null;
    this.exitPromise = null;

    this.emit('exit', code, signal);
  }
}
