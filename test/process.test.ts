import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowcaseError } from '../src/errors.js';
import { startCommand } from '../src/process.js';
import { isAlive, tempDir } from './helpers.js';

// Record every tree kill the module attempts, while still letting it happen.
const kills = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: ((command: string, args: readonly string[], options: object) => {
      if (command === 'taskkill') kills.list.push(`taskkill ${args.join(' ')}`);
      return actual.spawnSync(command, args, options);
    }) as typeof actual.spawnSync,
  };
});

function watchGroupKills(): void {
  const original = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (pid < 0 && signal !== 0) kills.list.push(`kill ${String(pid)} ${String(signal)}`);
    return original(pid, signal);
  });
}

afterEach(() => {
  kills.list.length = 0;
  vi.restoreAllMocks();
});

describe('startCommand', () => {
  it('turns a failed spawn into a ShowcaseError, not an uncaught exception', async () => {
    const missing = join(tempDir(), 'does-not-exist');
    expect(() => startCommand('node -v', { cwd: missing })).toThrow(ShowcaseError);
    // The spawn error event fires on a later tick; without a listener it would crash the run here.
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  it('does not kill by PID once the process has exited: the PID may already belong to someone else', async () => {
    watchGroupKills();
    const started = startCommand('node -e "process.exit(0)"', { cwd: process.cwd() });
    expect(await started.exited).toBe(0);
    await started.stop();
    expect(kills.list).toEqual([]);
  });

  it('holds SIGINT/SIGTERM/SIGHUP/exit handlers only while a started process is alive', async () => {
    const events = ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'] as const;
    const counts = (): number[] => events.map(event => process.listenerCount(event));
    const baseline = counts();

    expect(() => startCommand('node -v', { cwd: join(tempDir(), 'missing') })).toThrow(ShowcaseError);
    expect(counts()).toEqual(baseline);

    const first = startCommand('node -e "setInterval(() => {}, 1000)"', { cwd: process.cwd() });
    const second = startCommand('node -e "setInterval(() => {}, 1000)"', { cwd: process.cwd() });
    expect(counts()).toEqual(baseline.map(count => count + 1));
    await first.stop();
    expect(counts()).toEqual(baseline.map(count => count + 1));
    await second.stop();
    expect(counts()).toEqual(baseline);

    // A process that ends on its own releases them too.
    const quick = startCommand('node -e "process.exit(0)"', { cwd: process.cwd() });
    expect(counts()).toEqual(baseline.map(count => count + 1));
    await quick.exited;
    expect(counts()).toEqual(baseline);
  });

  it('still kills a live process tree', async () => {
    watchGroupKills();
    const started = startCommand('node -e "setInterval(() => {}, 1000)"', { cwd: process.cwd() });
    await new Promise(resolve => setTimeout(resolve, 300));
    const begin = performance.now();
    await started.stop();
    // A tree that ends on the first signal must not sit out the grace period before a forced kill.
    expect(performance.now() - begin).toBeLessThan(1_000);
    expect(kills.list).toHaveLength(1);
    expect(kills.list[0]).toMatch(process.platform === 'win32' ? /^taskkill \/PID \d+ \/T \/F$/ : /^kill -\d+ SIGTERM$/);
    expect(isAlive(started.pid)).toBe(false);
  });

  it('force kills a tree that ignores SIGTERM once the grace period is over', async () => {
    watchGroupKills();
    const started = startCommand(
      `node -e "process.on('SIGTERM', () => {}); console.log('ready ' + process.pid); setInterval(() => {}, 1000)"`,
      { cwd: process.cwd() },
    );
    // Signal only after the handler is in place, or node would still die on the SIGTERM.
    const deadline = Date.now() + 10_000;
    let ready: RegExpMatchArray | null = null;
    while (!(ready = /^ready (\d+)$/m.exec(started.tail())) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(ready).not.toBeNull();
    const nodePid = Number(ready?.[1]);
    await started.stop();
    expect(kills.list).toEqual(
      process.platform === 'win32'
        ? [`taskkill /PID ${String(started.pid)} /T /F`]
        : [`kill -${String(started.pid)} SIGTERM`, `kill -${String(started.pid)} SIGKILL`],
    );
    expect(isAlive(nodePid)).toBe(false);
    expect(isAlive(started.pid)).toBe(false);
  });
});
