import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeAnimation, findExecutable, gifDelays, splitDelays, type AnimationFrame, type EncodeOptions } from '../src/encode.js';
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

  it('encodes a single frame (a screen that never changed) in both formats', async () => {
    for (const format of ['webp', 'gif'] as const) {
      const data = await encodeAnimation(await frames([1500]), { format });
      const meta = await sharp(data, { animated: true }).metadata();
      expect([meta.format, meta.pages ?? 1, meta.width, meta.height]).toEqual([format, 1, 40, 30]);
    }
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

  it('refuses input it cannot encode with a ShowcaseError, before any image work', async () => {
    const [good] = await frames([100]);
    const cases: Array<[unknown, unknown, RegExp]> = [
      [good ? [good] : [], { format: 'avif' }, /unknown format "avif"/],
      ['not frames', { format: 'webp' }, /no frames to encode/],
      [[{ png: 'x.png', delayMs: 100 }], { format: 'gif' }, /frame 0 has no image data/],
      [[good, { png: Buffer.alloc(0), delayMs: 100 }], { format: 'webp' }, /frame 1 has no image data/],
      [[good, { png: Buffer.from('not an image'), delayMs: 100 }], { format: 'webp' }, /frame 1 is not a readable image/],
      [[good, { png: good?.png, delayMs: Infinity }], { format: 'gif' }, /frame 1 has a delay of Infinityms/],
      [[good, { png: good?.png, delayMs: -5 }], { format: 'mp4' }, /frame 1 has a delay of -5ms/],
    ];
    for (const [input, opts, message] of cases) {
      const error = await encodeAnimation(input as AnimationFrame[], opts as EncodeOptions).catch((caught: unknown) => caught);
      expect(error, String(message)).toBeInstanceOf(ShowcaseError);
      expect((error as Error).message).toMatch(message);
    }
  });

  it('splits a delay longer than sharp takes into repeats that add up to it, in WebP and GIF', async () => {
    // Over sharp's 65535 ms per frame, and for GIF over the format's own 655350 ms (hundredths in 16 bits). The
    // encoders merge the repeats again as far as their format allows, so only the sum and the order are fixed.
    const input = await frames([100, 200_000, 700_010, 150]);
    for (const format of ['webp', 'gif'] as const) {
      const data = await encodeAnimation(input, { format });
      const meta = await sharp(data, { animated: true }).metadata();
      const delays = meta.delay ?? [];
      expect(delays.reduce((sum, delay) => sum + delay, 0), format).toBe(900_260);
      // The pieces repeat their frame: the colors still come in order, red, green, blue, white.
      const colors = await pageColors(data, meta.pages ?? 1);
      expect(colors.filter((color, index) => index === 0 || color.join() !== colors[index - 1]?.join()), format).toEqual([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 255],
      ]);
    }
  });

  it('says how to get ffmpeg when MP4 is asked for and ffmpeg is not on PATH', async () => {
    vi.stubEnv('PATH', tempDir('showcase-empty-path-'));
    await expect(encodeAnimation(await frames([100, 100]), { format: 'mp4' })).rejects.toThrow(
      /^MP4 needs ffmpeg on PATH, and none was found\..*drop "mp4" from the formats/,
    );
  });

  // Conditional: MP4 is opt-in and needs an ffmpeg binary, which CI runners do not all have.
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

describe('splitDelays', () => {
  it('leaves short delays alone and splits long ones into near-equal pieces of whole units', () => {
    expect(splitDelays([100, 65_535], 65_535, 1)).toEqual([
      { frame: 0, delayMs: 100 },
      { frame: 1, delayMs: 65_535 },
    ]);
    expect(splitDelays([65_536], 65_535, 1)).toEqual([
      { frame: 0, delayMs: 32_768 },
      { frame: 0, delayMs: 32_768 },
    ]);
    const gif = splitDelays([700_010], 65_530, 10);
    expect(gif).toHaveLength(11);
    expect(gif.every(piece => piece.delayMs % 10 === 0 && piece.delayMs >= 20 && piece.delayMs <= 65_530)).toBe(true);
    expect(gif.reduce((sum, piece) => sum + piece.delayMs, 0)).toBe(700_010);
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
