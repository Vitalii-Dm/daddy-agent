// @vitest-environment node
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import * as child from 'child_process';
import {
  PythonVizServer,
  type ReadinessProbe,
} from '@main/services/knowledgeGraph/PythonVizServer';

/**
 * Minimal stand-in for `ChildProcessWithoutNullStreams` that gives us full
 * control over stdout/stderr streams and the exit lifecycle.
 */
class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  pid: number | undefined = 4242;
  killed = false;
  killCalls: NodeJS.Signals[] = [];
  /** When set, kill() will not auto-emit exit; tests must call simulateExit. */
  manualExit = false;

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killCalls.push(signal);
    if (this.killed) return true;
    this.killed = true;
    if (!this.manualExit) {
      // Mimic an immediate clean exit on the next microtask.
      queueMicrotask(() => {
        this.simulateExit(0, signal);
      });
    }
    return true;
  }

  simulateExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('exit', code, signal);
  }
}

function spawnMock(): Mock {
  return child.spawn as unknown as Mock;
}

beforeEach(() => {
  vi.useFakeTimers();
  spawnMock().mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Build a probe that returns the requested status code on the Nth call (1-based)
 * and `null` (unreachable) for earlier calls.
 */
function makeProbe(plan: Array<number | null>): ReadinessProbe {
  let i = 0;
  return async () => {
    const value = plan[Math.min(i, plan.length - 1)] ?? null;
    i += 1;
    return value;
  };
}

/** Resolve the next macrotask queue (Promises + microtasks). */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PythonVizServer', () => {
  it("start() resolves with serverStatus = 'running' once readiness probe succeeds (200)", async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
    });

    const startPromise = server.start();
    await vi.advanceTimersByTimeAsync(50);
    const health = await startPromise;

    expect(health.serverStatus).toBe('running');
    expect(health.neo4jStatus).toBe('reachable');
    expect(health.pid).toBe(4242);
    expect(health.lastError).toBeNull();
    expect(spawnMock()).toHaveBeenCalledTimes(1);

    // baseUrl is now valid.
    expect(server.baseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it('503 from /healthz still flips status to running but marks Neo4j unreachable', async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([503]);

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
    });

    const startPromise = server.start();
    await vi.advanceTimersByTimeAsync(50);
    const health = await startPromise;

    expect(health.serverStatus).toBe('running');
    expect(health.neo4jStatus).toBe('unreachable');
  });

  it('200 from /healthz marks neo4jStatus reachable', async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([null, null, 200]);

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 5000,
    });

    const startPromise = server.start();
    await vi.advanceTimersByTimeAsync(20);
    const health = await startPromise;

    expect(health.serverStatus).toBe('running');
    expect(health.neo4jStatus).toBe('reachable');
  });

  it('start() is idempotent — second call does not spawn a second subprocess', async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
    });

    const firstStart = server.start();
    await vi.advanceTimersByTimeAsync(20);
    await firstStart;

    const second = await server.start();
    expect(second.serverStatus).toBe('running');
    expect(spawnMock()).toHaveBeenCalledTimes(1);
  });

  it('readiness timeout → serverStatus crashed, lastError set, subprocess killed', async () => {
    const fake = new FakeChildProcess();
    fake.manualExit = true; // Don't auto-exit on kill so we can observe state.
    spawnMock().mockReturnValue(fake);
    const probe: ReadinessProbe = async () => null;

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 50,
      readinessTimeoutMs: 200,
      sigtermGraceMs: 100,
    });

    const startPromise = server.start();

    // Drive the readiness loop past its timeout.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(50);
      await flush();
    }
    // Once readiness times out, killChild waits for exit. Drive that too.
    await vi.advanceTimersByTimeAsync(150);
    await flush();
    // After SIGKILL grace we still need an exit; emit one so kill resolves.
    fake.simulateExit(null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(50);

    const health = await startPromise;

    expect(health.serverStatus).toBe('crashed');
    expect(health.lastError).toMatch(/readiness/i);
    expect(fake.killCalls.length).toBeGreaterThanOrEqual(1);
    expect(fake.killCalls[0]).toBe('SIGTERM');
  });

  it('stop() sends SIGTERM, waits for exit, returns serverStatus stopped', async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
      sigtermGraceMs: 1000,
    });

    const startPromise = server.start();
    await vi.advanceTimersByTimeAsync(20);
    await startPromise;

    const stopPromise = server.stop();
    await vi.advanceTimersByTimeAsync(20);
    await flush();
    const health = await stopPromise;

    expect(health.serverStatus).toBe('stopped');
    expect(fake.killCalls).toContain('SIGTERM');
  });

  it('stop() while stopped is a no-op', async () => {
    const server = new PythonVizServer({
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
    });
    const health = await server.stop();
    expect(health.serverStatus).toBe('stopped');
    expect(spawnMock()).not.toHaveBeenCalled();
  });

  it("subprocess exits unexpectedly while running → serverStatus 'crashed', 'exit' event fires", async () => {
    const fake = new FakeChildProcess();
    fake.manualExit = true;
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
    });

    const exitListener = vi.fn();
    server.on('exit', exitListener);

    const startPromise = server.start();
    await vi.advanceTimersByTimeAsync(20);
    await startPromise;

    expect((await server.getHealth()).serverStatus).toBe('running');

    // Push some stderr lines so the crash report has context.
    fake.stderr.write('boom: traceback line 1\n');
    fake.stderr.write('boom: traceback line 2\n');
    await flush();

    fake.simulateExit(1, null);
    await flush();

    const health = await server.getHealth();
    expect(health.serverStatus).toBe('crashed');
    expect(health.lastError).toContain('exited');
    expect(health.lastError).toContain('boom: traceback line 1');
    expect(exitListener).toHaveBeenCalledWith(1, null);
  });

  it('baseUrl() throws when not running, returns the URL when running', async () => {
    const server = new PythonVizServer({
      port: 9750,
      host: '127.0.0.1',
    });
    expect(() => server.baseUrl()).toThrow(/not running/);

    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);
    const ready = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
      port: 9999,
      host: '127.0.0.1',
    });
    const startPromise = ready.start();
    await vi.advanceTimersByTimeAsync(20);
    await startPromise;
    expect(ready.baseUrl()).toBe('http://127.0.0.1:9999');
  });

  it('subprocess exits before readiness → serverStatus crashed', async () => {
    const fake = new FakeChildProcess();
    fake.manualExit = true;
    spawnMock().mockReturnValue(fake);
    const probe: ReadinessProbe = async () => null;

    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 50,
      readinessTimeoutMs: 5000,
    });

    const startPromise = server.start();
    // Let one probe attempt happen, then crash the child.
    await vi.advanceTimersByTimeAsync(20);
    fake.stderr.write('ImportError: no module named daddy_agent.viz\n');
    await flush();
    fake.simulateExit(127, null);
    await vi.advanceTimersByTimeAsync(50);
    await flush();

    const health = await startPromise;
    expect(health.serverStatus).toBe('crashed');
    expect(health.lastError).toContain('ImportError');
  });

  it('emits stderr lines as they arrive', async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);
    const server = new PythonVizServer({
      probe,
      pollIntervalMs: 5,
      readinessTimeoutMs: 1000,
    });

    const stderrLines: string[] = [];
    server.on('stderr', (line) => stderrLines.push(line));

    const startPromise = server.start();
    await vi.advanceTimersByTimeAsync(20);
    await startPromise;

    fake.stderr.write('line one\n');
    fake.stderr.write('partial');
    await flush();
    fake.stderr.write(' line two\nline three\n');
    await flush();

    expect(stderrLines).toEqual(['line one', 'partial line two', 'line three']);
  });

  it('passes Neo4j env vars and caller overrides into spawn', async () => {
    const fake = new FakeChildProcess();
    spawnMock().mockReturnValue(fake);
    const probe = makeProbe([200]);
    const prev = {
      NEO4J_URI: process.env.NEO4J_URI,
      NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
    };
    process.env.NEO4J_URI = 'bolt://test:7687';
    process.env.NEO4J_PASSWORD = 'parent-secret';

    try {
      const server = new PythonVizServer({
        probe,
        pollIntervalMs: 5,
        readinessTimeoutMs: 1000,
        env: { NEO4J_PASSWORD: 'override', EXTRA: 'yes' },
      });
      const startPromise = server.start();
      await vi.advanceTimersByTimeAsync(20);
      await startPromise;
    } finally {
      if (prev.NEO4J_URI === undefined) delete process.env.NEO4J_URI;
      else process.env.NEO4J_URI = prev.NEO4J_URI;
      if (prev.NEO4J_PASSWORD === undefined) delete process.env.NEO4J_PASSWORD;
      else process.env.NEO4J_PASSWORD = prev.NEO4J_PASSWORD;
    }

    const call = spawnMock().mock.calls[0];
    const env = (call[2] as { env: NodeJS.ProcessEnv }).env;
    expect(env.NEO4J_URI).toBe('bolt://test:7687');
    expect(env.NEO4J_PASSWORD).toBe('override'); // caller wins
    expect(env.EXTRA).toBe('yes');
    expect(env.PATH).toBe(process.env.PATH);
  });
});
