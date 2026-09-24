import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAnimation, findExecutable } from '../src/encode.js';

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
