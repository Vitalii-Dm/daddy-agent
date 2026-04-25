/**
 * Spawns the Python codebase indexer (`daddy-index`) against an arbitrary repo
 * root so the Aurora renderer can index whichever project the user is
 * currently working in.
 *
 * Lives next to PythonVizServer because it shares the same Python interpreter
 * resolution + Neo4j env passthrough; keeping the two coordinated avoids
 * subtle "indexed with one venv, queried with another" footguns.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { createLogger } from '@shared/utils/logger';
import type { KGReindexRequest, KGReindexResult } from '@shared/types/knowledgeGraph';

const logger = createLogger('KG:Indexer');

const STDERR_TAIL_LINES = 80;
const NEO4J_PASSTHROUGH_KEYS = [
  'NEO4J_URI',
  'NEO4J_USER',
  'NEO4J_PASSWORD',
  'NEO4J_CODEBASE_DB',
  'NEO4J_MEMORY_DB',
] as const;

export interface KnowledgeGraphIndexerOptions {
  /** Path to the Python interpreter (resolved venv). */
  pythonBin: string;
  /** Working directory for the spawn — usually the daddy-agent repo root. */
  cwd: string;
}

export class KnowledgeGraphIndexer {
  constructor(private readonly options: KnowledgeGraphIndexerOptions) {}

  reindex(request: KGReindexRequest): Promise<KGReindexResult> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      if (!request.projectRoot) {
        reject(new Error('projectRoot is required'));
        return;
      }
      if (!existsSync(request.projectRoot)) {
        reject(new Error(`projectRoot does not exist: ${request.projectRoot}`));
        return;
      }
      const args = [
        '-m',
        'daddy_agent.codebase_graph.indexer',
        request.projectRoot,
        '--project-root',
        request.projectRoot,
      ];
      if (request.full) args.push('--full');

      logger.info(`spawning ${this.options.pythonBin} ${args.join(' ')}`);

      const child = spawn(this.options.pythonBin, args, {
        cwd: this.options.cwd,
        env: this.buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stderrBuffer: string[] = [];
      let carry = '';

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        const combined = carry + chunk;
        const lines = combined.split(/\r?\n/);
        carry = lines.pop() ?? '';
        for (const line of lines) {
          if (line.length === 0) continue;
          stderrBuffer.push(line);
          if (stderrBuffer.length > STDERR_TAIL_LINES) {
            stderrBuffer.splice(0, stderrBuffer.length - STDERR_TAIL_LINES);
          }
        }
      });
      // We don't actually consume stdout but keep the stream drained so the
      // child doesn't block once its pipe buffer fills.
      child.stdout.setEncoding('utf8');
      child.stdout.resume();

      child.on('error', (err) => {
        logger.error('indexer spawn error', err);
        reject(err);
      });

      child.on('exit', (code, signal) => {
        if (carry.length > 0) stderrBuffer.push(carry);
        const stderrTail = stderrBuffer.slice(-STDERR_TAIL_LINES).join('\n');
        const exitCode = code ?? (signal ? -1 : 0);
        const duration = Date.now() - start;
        if (exitCode !== 0) {
          logger.warn(
            `indexer exited with ${signal ? `signal ${signal}` : `code ${code}`} after ${duration}ms`
          );
        } else {
          logger.info(`indexer finished in ${duration}ms`);
        }
        resolve({
          projectRoot: request.projectRoot,
          exitCode,
          stderrTail,
          durationMs: duration,
        });
      });
    });
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
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
      'SystemRoot',
      'SYSTEMROOT',
      'APPDATA',
      'LOCALAPPDATA',
      'USERPROFILE',
    ];
    for (const key of passthroughKeys) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    for (const key of NEO4J_PASSTHROUGH_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    return env;
  }
}

/**
 * Resolve a Python interpreter from a project-local venv before falling back
 * to PATH. Mirrors the resolver in main/index.ts so the indexer's Python is
 * the same one the sidecar spawns with.
 */
export function resolveIndexerPythonBin(cwd: string): string {
  const candidates = ['.venv/bin/python3', '.venv-check/bin/python3'];
  for (const rel of candidates) {
    const abs = join(cwd, rel);
    if (existsSync(abs)) return abs;
  }
  return 'python3';
}
