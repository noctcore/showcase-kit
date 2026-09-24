import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import sharp from 'sharp';
import { ShowcaseError } from './errors.js';

export type AnimationFormat = 'webp' | 'gif' | 'mp4';

/** One frame of an animation: a PNG and how long it stays on screen. */
export interface AnimationFrame {
  png: Buffer;
  delayMs: number;
}

export interface EncodeOptions {
  format: AnimationFormat;
  /** How many times WebP and GIF play; 0 loops forever. Default 0. MP4 does not loop. */
  loop?: number;
  /** WebP only: a lossy quality from 1 to 100. Default: lossless, which is smallest for flat terminal colors. */
  quality?: number;
  /** MP4 only: the constant frame rate of the video. Default 30. */
  fps?: number;
}

const FFMPEG_MISSING =
  'MP4 needs ffmpeg on PATH, and none was found. Install it (https://ffmpeg.org/download.html, or ' +
  '`winget install ffmpeg`, `brew install ffmpeg`, `apt install ffmpeg`), or drop "mp4" from the formats: ' +
  'WebP and GIF need nothing extra.';

/**
 * Encode frames as an animated WebP or GIF (with sharp) or an MP4 (with `ffmpeg` from PATH).
 *
 * Every frame must have the same size. Frames are kept as given: merge identical neighbours before calling (the
 * encoders merge them too). GIF stores delays in hundredths of a second, so they are rounded on a running total:
 * the clip keeps its length and no frame is shorter than 20 ms, which browsers would stretch to 100 ms.
 */
export async function encodeAnimation(frames: AnimationFrame[], opts: EncodeOptions): Promise<Buffer> {
  const { format, loop = 0 } = opts;
  if (frames.length === 0) throw new ShowcaseError('encodeAnimation: no frames to encode.');
  if (!Number.isInteger(loop) || loop < 0) {
    throw new ShowcaseError(`encodeAnimation: loop must be a whole number >= 0, got ${String(loop)}`);
  }
  for (const [index, frame] of frames.entries()) {
    if (!(Number.isFinite(frame.delayMs) && frame.delayMs > 0)) {
      throw new ShowcaseError(`encodeAnimation: frame ${String(index)} has a delay of ${String(frame.delayMs)}ms (must be > 0).`);
    }
  }
  const size = await frameSize(frames);
  const delays = frames.map(frame => Math.max(1, Math.round(frame.delayMs)));
  if (format === 'mp4') return encodeMp4(frames, size, opts.fps ?? 30);

  // A screen that never changed is one frame, and sharp cannot join fewer than two images.
  const joined =
    frames.length === 1 ? sharp(frames[0]?.png) : sharp(frames.map(frame => frame.png), { join: { animated: true } });
  if (format === 'webp') {
    const { quality } = opts;
    if (quality !== undefined && !(Number.isInteger(quality) && quality >= 1 && quality <= 100)) {
      throw new ShowcaseError(`encodeAnimation: quality must be a whole number from 1 to 100, got ${String(quality)}`);
    }
    const look = quality === undefined ? { lossless: true } : { quality };
    return joined.webp({ ...look, effort: 4, delay: delays, loop }).toBuffer();
  }
  if (format === 'gif') {
    return joined.gif({ delay: gifDelays(delays), loop, effort: 7 }).toBuffer();
  }
  throw new ShowcaseError(`encodeAnimation: unknown format ${JSON.stringify(format)} (use webp, gif or mp4).`);
}

/** The shared frame size; every frame must match the first. */
async function frameSize(frames: AnimationFrame[]): Promise<{ width: number; height: number }> {
  const sizes = await Promise.all(frames.map(async frame => sharp(frame.png).metadata()));
  const [first] = sizes;
  const width = first?.width ?? 0;
  const height = first?.height ?? 0;
  const odd = sizes.findIndex(meta => meta.width !== width || meta.height !== height);
  if (odd >= 0) {
    throw new ShowcaseError(
      `encodeAnimation: every frame must have the same size; frame 0 is ${String(width)}x${String(height)}, ` +
        `frame ${String(odd)} is ${String(sizes[odd]?.width)}x${String(sizes[odd]?.height)}.`,
    );
  }
  return { width, height };
}

/**
 * Delays in whole hundredths of a second (as ms), rounded on the running total so the sum stays the clip length.
 * A frame under 20 ms is lengthened to 20 ms: browsers play shorter GIF delays as 100 ms.
 */
export function gifDelays(delays: number[]): number[] {
  let elapsed = 0;
  let shown = 0;
  return delays.map(delay => {
    elapsed += delay;
    const end = Math.max(shown + 20, Math.round(elapsed / 10) * 10);
    const result = end - shown;
    shown = end;
    return result;
  });
}

/** An executable on PATH, found without a shell. On Windows only `<name>.exe` counts: a `.cmd` needs a shell. */
export function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  // Windows spells it `Path`; a plain object (not process.env) is case-sensitive.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
  const dirs = (pathKey === undefined ? '' : (env[pathKey] ?? '')).split(delimiter).filter(Boolean);
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of dirs) {
    const candidate = join(dir.replace(/^"(.*)"$/, '$1'), file);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here, or not executable.
    }
  }
  return undefined;
}

/** `ffmpeg` from PATH, or a `ShowcaseError` that says how to get it. */
export function requireFfmpeg(): string {
  const ffmpeg = findExecutable('ffmpeg');
  if (!ffmpeg) throw new ShowcaseError(FFMPEG_MISSING);
  return ffmpeg;
}

async function encodeMp4(frames: AnimationFrame[], size: { width: number; height: number }, fps: number): Promise<Buffer> {
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 120)) {
    throw new ShowcaseError(`encodeAnimation: fps must be a whole number from 1 to 120, got ${String(fps)}`);
  }
  const ffmpeg = requireFfmpeg();
  const total = frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  const dir = await mkdtemp(join(tmpdir(), 'showcase-mp4-'));
  try {
    const names = frames.map((_, index) => `${String(index).padStart(5, '0')}.png`);
    await Promise.all(frames.map((frame, index) => writeFile(join(dir, names[index] ?? ''), frame.png)));
    // The concat demuxer takes a duration per file; the last file is listed twice or its duration is dropped, and
    // images still run long at the end, so `-t` cuts the video to the clip length.
    const list = frames.map((frame, index) => `file '${names[index] ?? ''}'\nduration ${(frame.delayMs / 1000).toFixed(3)}`);
    list.push(`file '${names[names.length - 1] ?? ''}'`);
    await writeFile(join(dir, 'frames.txt'), `${list.join('\n')}\n`);
    // H.264 in yuv420p needs even sides; pad by one pixel rather than scale, so text stays sharp.
    const pad = size.width % 2 === 0 && size.height % 2 === 0 ? '' : ',pad=ceil(iw/2)*2:ceil(ih/2)*2';
    await run(ffmpeg, [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.txt',
      '-t', (total / 1000).toFixed(3), '-vf', `fps=${String(fps)}${pad}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
      '-preset', 'slow', '-movflags', '+faststart', 'clip.mp4',
    ], dir);
    return await readFile(join(dir, 'clip.mp4'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', error => reject(new ShowcaseError(`Could not run ${file}: ${error.message}`)));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new ShowcaseError(`ffmpeg failed (exit code ${String(code)}):\n${stderr.trim()}`));
    });
  });
}
