import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { ShowcaseError } from './errors.js';
import { log } from './log.js';

const isWindows = process.platform === 'win32';

export interface StartedProcess {
  pid: number;
  /** Kill the whole process tree and wait until it is gone. Safe to call twice. */
  stop(): Promise<void>;
  /** Resolves when the process exits on its own. */
  exited: Promise<number | null>;
  /** The last lines the process printed, for error messages. */
  tail(): string;
}

/** Grace period between SIGTERM and SIGKILL when stopping a tree on POSIX. */
const KILL_GRACE_MS = 2_000;

/** True when `promise` settles within `ms`. Clears its timer, so a long timeout never holds the host open. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(resolve, Math.max(0, ms), false);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Send `signal` to the process group led by `pid`. False when the group no longer exists. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    // EPERM means a member exists but belongs to someone else: still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Poll until the process group led by `pid` is empty. It must yield to the event loop between polls: a blocking
 * wait keeps libuv from reaping our exited leader, and a zombie still counts as a member of its group.
 */
async function groupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!signalGroup(pid, 0)) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return !signalGroup(pid, 0);
}

/**
 * Kill `pid` and all its descendants, synchronously, for the `exit` and signal handlers where nothing can wait.
 * On POSIX that is SIGKILL right away: without a wait a SIGTERM would not buy any clean shutdown, and a blocking
 * wait cannot reap the exited leader (see `groupGone`), so it would always run to its timeout.
 */
export function killTreeSync(pid: number): void {
  if (isWindows) {
    // By PID with /T, never by image name: `node.exe` would take every other worktree down with it.
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  // POSIX: the child was spawned detached, so it leads its own process group. Signal the group.
  signalGroup(pid, 'SIGKILL');
}

/**
 * Kill the tree led by `pid` and wait until it is gone: false if something outlived `timeoutMs`. On POSIX it
 * sends SIGTERM to the group, and SIGKILL only if a member is still alive after the grace period.
 */
async function killTree(pid: number, exited: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  if (isWindows) {
    killTreeSync(pid);
    return settlesWithin(exited, timeoutMs);
  }
  const deadline = Date.now() + timeoutMs;
  const graceEnd = Date.now() + KILL_GRACE_MS;
  if (!signalGroup(pid, 'SIGTERM')) return true;
  // Wait for the leader first. Once its exit is observed libuv has reaped it, so the group check only sees real
  // survivors. The ID cannot be handed to a new process while its group still exists, so signalling the group
  // after the leader is gone reaches our own descendants or nothing.
  if ((await settlesWithin(exited, KILL_GRACE_MS)) && (await groupGone(pid, graceEnd - Date.now()))) return true;
  signalGroup(pid, 'SIGKILL');
  return (await settlesWithin(exited, deadline - Date.now())) && (await groupGone(pid, deadline - Date.now()));
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Started processes that are still alive. */
const running = new Set<StartedProcess>();

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

function killRunning(): void {
  for (const child of running) killTreeSync(child.pid);
  running.clear();
}

const signalHandlers = new Map(
  SIGNALS.map(signal => [
    signal,
    (): void => {
      log.warn(`\nReceived ${signal}, stopping started processes.`);
      killRunning();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    },
  ]),
);

/**
 * Ctrl+C and friends must not leave a dev server behind, but a library must not own the host's shutdown
 * either: the handlers exist only while at least one started process is alive.
 */
function track(handle: StartedProcess): void {
  if (running.size === 0) {
    process.on('exit', killRunning);
    for (const [signal, handler] of signalHandlers) process.on(signal, handler);
  }
  running.add(handle);
}

function untrack(handle: StartedProcess): void {
  if (!running.delete(handle) || running.size > 0) return;
  process.off('exit', killRunning);
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
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
    child.on('exit', code => {
      untrack(handle);
      resolve(code);
    });
    child.on('error', () => resolve(null));
  });

  let stopping: Promise<void> | undefined;
  const handle: StartedProcess = {
    pid,
    exited,
    tail: () => lines.join('\n'),
    stop() {
      stopping ??= (async () => {
        untrack(handle);
        // Once the child has exited its PID can be reused (Windows does so quickly), and a tree kill
        // would hit whatever owns it now. Until the exit is observed, Node holds the process handle open,
        // so the PID still refers to our child.
        if (!hasExited(child)) {
          if (!(await killTree(pid, exited, 10_000))) {
            log.warn(`${label}: process ${String(pid)} is still running after kill.`);
          }
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
      })();
      return stopping;
    },
  };
  track(handle);
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
