import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { ShowcaseError } from './errors.js';
import { log } from './log.js';

const isWindows = process.platform === 'win32';

export interface StartedProcess {
  pid: number;
  /** Kill the whole process tree and wait until the root is gone. Safe to call twice. */
  stop(): Promise<void>;
  /** Resolves when the process exits on its own. */
  exited: Promise<number | null>;
  /** The last lines the process printed, for error messages. */
  tail(): string;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else: still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Kill `pid` and all its descendants, synchronously. Works from an `exit` handler. */
export function killTreeSync(pid: number): void {
  if (isWindows) {
    // By PID with /T, never by image name: `node.exe` would take every other worktree down with it.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  // POSIX: the child was spawned detached, so it leads its own process group. Signal the group.
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      return;
    }
    if (signal === 'SIGTERM') {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        try {
          process.kill(-pid, 0);
        } catch {
          return;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
  }
}

async function waitGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return !isAlive(pid);
}

const running = new Set<StartedProcess>();
let handlersInstalled = false;

/** Ctrl+C and friends must not leave a dev server behind. */
function installExitHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const cleanup = (): void => {
    for (const child of running) killTreeSync(child.pid);
    running.clear();
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      log.warn(`\nReceived ${signal}, stopping started processes.`);
      cleanup();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

/**
 * Run a shell command (for example `pnpm dev:web`) in its own process tree.
 *
 * It goes through the shell on every platform: `pnpm`, `bun` and `npm` are `.cmd` shims on Windows and
 * cannot be spawned directly, and users write `start` as they would type it.
 */
export function startCommand(
  command: string,
  { cwd, env, label = 'start' }: { cwd: string; env?: Record<string, string>; label?: string },
): StartedProcess {
  installExitHandlers();
  const child: ChildProcess = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    // POSIX: own process group, so the whole tree can be signalled at once.
    detached: !isWindows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Listen before anything can throw: a failed spawn (missing cwd, no shell) reports on a later tick,
  // and an `error` event without a listener would crash the host process.
  let spawnError: Error | undefined;
  child.on('error', error => {
    spawnError = error;
  });
  if (child.pid === undefined) {
    throw new ShowcaseError(`Could not start \`${command}\` in ${cwd}${spawnError ? `: ${spawnError.message}` : ''}`);
  }
  const pid = child.pid;
  log.debug(`${label}: \`${command}\` started (pid ${String(pid)})`);

  const lines: string[] = [];
  const collect = (chunk: Buffer): void => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines.push(line);
      if (lines.length > 40) lines.shift();
      log.debug(`[${label}] ${line}`);
    }
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const exited = new Promise<number | null>(resolve => {
    child.on('exit', code => resolve(code));
    child.on('error', () => resolve(null));
  });

  let stopping: Promise<void> | undefined;
  const handle: StartedProcess = {
    pid,
    exited,
    tail: () => lines.join('\n'),
    stop() {
      stopping ??= (async () => {
        running.delete(handle);
        killTreeSync(pid);
        if (!(await waitGone(pid, 10_000))) {
          log.warn(`${label}: process ${String(pid)} is still running after kill.`);
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
      })();
      return stopping;
    },
  };
  running.add(handle);
  return handle;
}

/** Poll `url` until it answers with a non-error status, the process dies, or time runs out. */
export async function waitForUrl(
  url: string,
  { timeoutMs, process: started }: { timeoutMs: number; process?: StartedProcess },
): Promise<void> {
  let exitCode: number | null | undefined;
  void started?.exited.then(code => {
    exitCode = code;
  });
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (exitCode !== undefined) {
      throw new ShowcaseError(
        `The start command exited (code ${String(exitCode)}) before ${url} answered.` +
          (started?.tail() ? `\nLast output:\n${started.tail()}` : ''),
      );
    }
    if (await answers(url)) return;
    lastError = `no answer from ${url}`;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new ShowcaseError(
    `Timed out after ${String(timeoutMs)}ms waiting for ${url} (${lastError}).` +
      (started?.tail() ? `\nLast output:\n${started.tail()}` : ''),
  );
}

/** True when `url` answers with a status below 400. */
export async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: 'manual' });
    await response.body?.cancel();
    return response.status < 400;
  } catch {
    return false;
  }
}
