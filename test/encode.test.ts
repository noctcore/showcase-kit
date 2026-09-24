import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAnimation, findExecutable, gifDelays, type AnimationFrame } from '../src/encode.js';
import { ShowcaseError } from '../src/errors.js';
import { tempDir } from './helpers.js';

const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffffff'];

async function solid(color: string, width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

async function frames(delays: number[]): Promise<AnimationFrame[]> {
  return Promise.all(delays.map(async (delayMs, index) => ({ png: await solid(COLORS[index % COLORS.length] ?? '#000'), delayMs })));
}

/** The red, green and blue of the top left pixel of each page. */
async function pageColors(data: Buffer, pages: number): Promise<number[][]> {
  const colors: number[][] = [];
  for (let page = 0; page < pages; page++) {
    const { data: pixels } = await sharp(data, { page }).raw().toBuffer({ resolveWithObject: true });
    colors.push([pixels[0] ?? -1, pixels[1] ?? -1, pixels[2] ?? -1]);
  }
  return colors;
}

const ffmpeg = findExecutable('ffmpeg');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('encodeAnimation', () => {
  it('writes a lossless animated WebP with the given delays, in order, looping forever', async () => {
    const data = await encodeAnimation(await frames([100, 250, 1000]), { format: 'webp' });
    const meta = await sharp(data, { animated: true }).metadata();
    expect([meta.format, meta.pages, meta.loop, meta.width, meta.pageHeight]).toEqual(['webp', 3, 0, 40, 30]);
    expect(meta.delay).toEqual([100, 250, 1000]);
    // Lossless: the colors come back exactly.
    expect(await pageColors(data, 3)).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
  });

  it('takes a lossy WebP quality and a loop count', async () => {
    const input = await frames([100, 100]);
    const lossy = await encodeAnimation(input, { format: 'webp', quality: 50, loop: 3 });
    const meta = await sharp(lossy, { animated: true }).metadata();
    expect([meta.pages, meta.loop]).toEqual([2, 3]);
    await expect(encodeAnimation(input, { format: 'webp', quality: 0 })).rejects.toThrow(/quality must be a whole number/);
  });

  it('writes an animated GIF with delays in hundredths that keep the clip length', async () => {
    const data = await encodeAnimation(await frames([33, 33, 34, 1500]), { format: 'gif' });
    const meta = await sharp(data, { animated: true }).metadata();
    expect([meta.format, meta.pages, meta.loop]).toEqual(['gif', 4, 0]);
    expect(meta.delay).toEqual([30, 40, 30, 1500]);
    expect(await pageColors(data, 4)).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ]);
  });

  it('refuses frames of different sizes, no frames, and bad delays', async () => {
    const mixed = [
      { png: await solid('#ff0000'), delayMs: 100 },
      { png: await solid('#00ff00', 41, 30), delayMs: 100 },
    ];
    await expect(encodeAnimation(mixed, { format: 'webp' })).rejects.toThrow(
      'encodeAnimation: every frame must have the same size; frame 0 is 40x30, frame 1 is 41x30.',
    );
    await expect(encodeAnimation([], { format: 'gif' })).rejects.toThrow(ShowcaseError);
    await expect(encodeAnimation(await frames([100, 0]), { format: 'gif' })).rejects.toThrow(/frame 1 has a delay of 0ms/);
  });

  it('says how to get ffmpeg when MP4 is asked for and ffmpeg is not on PATH', async () => {
    vi.stubEnv('PATH', tempDir('showcase-empty-path-'));
    await expect(encodeAnimation(await frames([100, 100]), { format: 'mp4' })).rejects.toThrow(
      /^MP4 needs ffmpeg on PATH, and none was found\..*drop "mp4" from the formats/,
    );
  });

  // The one conditional test: MP4 is opt-in and needs an ffmpeg binary, which CI runners do not all have.
  it.runIf(ffmpeg !== undefined)('encodes an MP4 with ffmpeg from PATH (only where ffmpeg is installed)', async () => {
    // An odd size needs padding for yuv420p.
    const input = await Promise.all(
      [400, 600, 350].map(async (delayMs, index) => ({ png: await solid(COLORS[index] ?? '#000', 41, 31), delayMs })),
    );
    const data = await encodeAnimation(input, { format: 'mp4' });
    expect(data.subarray(4, 8).toString('latin1')).toBe('ftyp');
    const dir = tempDir();
    writeFileSync(join(dir, 'clip.mp4'), data);
    const probe = spawnSync(ffmpeg ?? 'ffmpeg', ['-hide_banner', '-i', join(dir, 'clip.mp4')], { encoding: 'utf8' });
    expect(probe.stderr).toMatch(/Duration: 00:00:01\.(3[0-9]|40)/);
    expect(probe.stderr).toMatch(/h264.*yuv420p.*42x32/);
  });
});

describe('gifDelays', () => {
  it('rounds on the running total so the sum stays the clip length', () => {
    const delays = Array.from({ length: 30 }, () => 1000 / 30);
    const result = gifDelays(delays);
    expect(result.every(delay => delay % 10 === 0 && delay >= 30 && delay <= 40)).toBe(true);
    expect(result.reduce((sum, delay) => sum + delay, 0)).toBe(1000);
  });

  it('never goes below 20 ms, which browsers would play as 100 ms', () => {
    expect(gifDelays([5, 5, 5, 100])).toEqual([20, 20, 20, 60]);
  });
});

describe('findExecutable', () => {
  it('finds a binary on PATH without a shell, and only a real file', () => {
    const dir = tempDir();
    const file = join(dir, process.platform === 'win32' ? 'fake-tool.exe' : 'fake-tool');
    writeFileSync(file, '');
    if (process.platform !== 'win32') chmodSync(file, 0o755);
    const other = tempDir();
    expect(findExecutable('fake-tool', { Path: [other, dir].join(process.platform === 'win32' ? ';' : ':') })).toBe(file);
    expect(findExecutable('fake-tool', { PATH: other })).toBeUndefined();
    expect(findExecutable('fake-tool', {})).toBeUndefined();
  });

  it.runIf(process.platform !== 'win32')('skips a file that is not executable (POSIX)', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'fake-tool'), '');
    chmodSync(join(dir, 'fake-tool'), 0o644);
    expect(findExecutable('fake-tool', { PATH: dir })).toBeUndefined();
  });
});
