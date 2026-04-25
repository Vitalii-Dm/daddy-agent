/**
 * CodebaseIndexer — spawns the Python `daddy_agent.codebase_graph.indexer`
 * CLI for a given project root so the knowledge-graph database stays in sync
 * with what the user is actually working on.
 *
 * Designed to be invoked from team-launch flows; a Neo4j-backed graph is the
 * point of having the sidecar around, but until something writes to it the
 * `daddy_agent.viz` server has nothing to expose. Best-effort by design — if
 * Python or the package isn't available we surface it via the result object,
 * we don't throw.
 */

import { spawn } from 'child_process';

import { createLogger } from '@shared/utils/logger';

const logger = createLogger('KG:CodebaseIndexer');

const STDERR_TAIL_BYTES = 2048;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface IndexerResult {
  exitCode: number | null;
  stderrTail: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CodebaseIndexerOptions {
  /** Path to a Python interpreter that has `daddy_agent` on sys.path. */
  pythonBin: string;
  /** Optional environment overlay; merged on top of process.env. */
  env?: NodeJS.ProcessEnv;
  /** Hard cap so a runaway indexer can't pin a CPU forever. */
  timeoutMs?: number;
}

export class CodebaseIndexer {
  private readonly pythonBin: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  /** Coalesce concurrent index calls per project root. */
  private readonly inFlight = new Map<string, Promise<IndexerResult>>();

  constructor(options: CodebaseIndexerOptions) {
    this.pythonBin = options.pythonBin;
    this.env = { ...process.env, ...(options.env ?? {}) };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async index(projectRoot: string): Promise<IndexerResult> {
    const trimmed = projectRoot.trim();
    if (!trimmed) {
      return {
        exitCode: null,
        stderrTail: 'projectRoot is empty',
        durationMs: 0,
        timedOut: false,
      };
    }

    const existing = this.inFlight.get(trimmed);
    if (existing) {
      return existing;
    }

    const work = this.runIndexer(trimmed).finally(() => {
      this.inFlight.delete(trimmed);
    });
    this.inFlight.set(trimmed, work);
    return work;
  }

  private runIndexer(projectRoot: string): Promise<IndexerResult> {
    const start = Date.now();
    return new Promise<IndexerResult>((resolve) => {
      const args = ['-m', 'daddy_agent.codebase_graph.indexer', projectRoot];
      logger.info(`indexing ${projectRoot} via ${this.pythonBin}`);

      let child;
      try {
        child = spawn(this.pythonBin, args, {
          cwd: projectRoot,
          env: this.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`indexer spawn threw: ${message}`);
        resolve({
          exitCode: null,
          stderrTail: message,
          durationMs: Date.now() - start,
          timedOut: false,
        });
        return;
      }

      const stderrChunks: string[] = [];
      let stderrBytes = 0;
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
        // Bound memory: trim from the front when we exceed twice the tail size.
        while (stderrBytes > STDERR_TAIL_BYTES * 2 && stderrChunks.length > 1) {
          const removed = stderrChunks.shift();
          stderrBytes -= removed?.length ?? 0;
        }
      });

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // Already gone.
        }
      }, this.timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`indexer error: ${message}`);
        resolve({
          exitCode: null,
          stderrTail: message,
          durationMs: Date.now() - start,
          timedOut,
        });
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        const stderrTail = stderrChunks.join('').slice(-STDERR_TAIL_BYTES);
        const durationMs = Date.now() - start;
        if (code === 0) {
          logger.info(`indexed ${projectRoot} in ${durationMs}ms`);
        } else {
          logger.warn(
            `indexer for ${projectRoot} exited code=${String(code)} ` +
              `timedOut=${timedOut} duration=${durationMs}ms ` +
              `stderr_tail=${stderrTail.slice(-512)}`
          );
        }
        resolve({
          exitCode: code,
          stderrTail,
          durationMs,
          timedOut,
        });
      });
    });
  }
}
