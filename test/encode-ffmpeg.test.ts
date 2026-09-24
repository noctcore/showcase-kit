import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAnimation, findExecutable, runFfmpeg } from '../src/encode.js';
import { ShowcaseError } from '../src/errors.js';
import { isAlive, tempDir } from './helpers.js';

/** How many `writeFile` calls are in flight at once, from the MP4 encoder's frame writes. */
const writes = vi.hoisted(() => ({ active: 0, max: 0 }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      writes.active++;
      writes.max = Math.max(writes.max, writes.active);
      try {
        return await actual.writeFile(...args);
      } finally {
        writes.active--;
      }
    },
  };
});

/** A stand-in for ffmpeg: holds a file open in its folder, like ffmpeg holds its input, and writes its PID. */
function stuckChild(pidFile: string): string[] {
  const script =
    "const fs = require('node:fs'); fs.openSync('held.png', 'w'); " +
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1e9);`;
  return ['-e', script];
}

const listeners = (): number =>
  process.listenerCount('SIGINT') + process.listenerCount('SIGTERM') + process.listenerCount('exit');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MP4 encoding', () => {
  it.runIf(findExecutable('ffmpeg') !== undefined)('writes the frame PNGs one at a time (only where ffmpeg is installed)', async () => {
    const frames = await Promise.all(
      ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#ff00ff'].map(async background => ({
        png: await sharp({ create: { width: 40, height: 30, channels: 3, background } }).png().toBuffer(),
        delayMs: 100,
      })),
    );
    writes.max = 0;
    const data = await encodeAnimation(frames, { format: 'mp4' });
    expect(data.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(writes.max).toBe(1);
  });
});

describe('runFfmpeg', () => {
  it('kills the child, removes its folder and exits 130 on Ctrl+C, then drops its handlers', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const dir = tempDir('showcase-mp4-');
    const pidFile = join(tempDir(), 'pid');
    const baseline = listeners();
    const before = process.listeners('SIGINT');
    const run = runFfmpeg(process.execPath, stuckChild(pidFile), dir).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(existsSync(pidFile) && existsSync(join(dir, 'held.png'))).toBe(true), { timeout: 10_000 });
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const added = process.listeners('SIGINT').filter(listener => !before.includes(listener));
    expect(added).toHaveLength(1);
    added[0]?.('SIGINT');
    expect(exit).toHaveBeenCalledWith(130);
    expect(existsSync(dir)).toBe(false);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 });
    // With exit mocked the run goes on and fails, which a real Ctrl+C never gets to.
    expect(await run).toBeInstanceOf(ShowcaseError);
    expect(listeners()).toBe(baseline);
  });

  it('stops a child that runs past the timeout, with a clear error', async () => {
    const dir = tempDir('showcase-mp4-');
    const pidFile = join(tempDir(), 'pid');
    const baseline = listeners();
    const error = await runFfmpeg(process.execPath, stuckChild(pidFile), dir, 1_500).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/^ffmpeg did not finish within 2 s and was stopped\./);
    expect(isAlive(Number(readFileSync(pidFile, 'utf8')))).toBe(false);
    expect(listeners()).toBe(baseline);
  });

  it('reports a failing child with its stderr', async () => {
    const error = await runFfmpeg(process.execPath, ['-e', "console.error('bad input'); process.exit(3)"], tempDir()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toBe('ffmpeg failed (exit code 3):\nbad input');
  });
});
