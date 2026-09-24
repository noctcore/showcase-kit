import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { launchBrowser } from './browser.js';
import { WEB_CLIPS_MESSAGE } from './config/clips.js';
import { isTtyConfig } from './config/resolve.js';
import type { ClipFormat, ResolvedClip, ResolvedConfig, ResolvedTtyConfig } from './config/types.js';
import { encodeAnimation, requireFfmpeg, type AnimationFrame } from './encode.js';
import { ShowcaseError } from './errors.js';
import { composeInHole, renderFrameHole } from './frame/render.js';
import { log } from './log.js';
import { fillTemplate } from './template.js';
import type { TtyEngine } from './tty/capture.js';
import type { TtyScreen, TtySession } from './tty/types.js';

export interface RecordOptions {
  /** Clip ids to record. Default: all. */
  only?: string[];
  /** Languages to record. Default: all in the config. */
  langs?: string[];
}

export interface RecordedFile {
  format: ClipFormat;
  path: string;
  bytes: number;
}

export interface RecordedClip {
  lang: string;
  id: string;
  /** Size of every frame, in pixels. */
  width: number;
  height: number;
  /** Frames after identical neighbours were merged. */
  frames: number;
  durationMs: number;
  files: RecordedFile[];
}

/** One screen of a recording and how many clock ticks it stayed. */
export interface ClipSample {
  screen: TtyScreen;
  ticks: number;
}

/** Absolute path of one clip file. */
export function clipPath(config: ResolvedConfig, lang: string, id: string, ext: ClipFormat): string {
  return resolve(config.root, fillTemplate(config.outputs.clips, { lang, id, slug: config.slug, ext }));
}

/** Apply `--only` and `--langs` to the clips, refusing names the config does not know. */
export function selectClips(
  config: ResolvedTtyConfig,
  only?: string[],
  langs?: string[],
): { clips: ResolvedClip[]; langs: string[] } {
  const unknown = (only ?? []).filter(id => !config.clips.some(clip => clip.id === id));
  if (unknown.length > 0) {
    throw new ShowcaseError(
      `Unknown clip id(s): ${unknown.join(', ')}. Known: ${config.clips.map(clip => clip.id).join(', ') || 'none'}`,
    );
  }
  const unknownLangs = (langs ?? []).filter(lang => !config.langs.includes(lang));
  if (unknownLangs.length > 0) {
    throw new ShowcaseError(`Unknown lang(s): ${unknownLangs.join(', ')}. Known: ${config.langs.join(', ')}`);
  }
  return {
    clips: only?.length ? config.clips.filter(clip => only.includes(clip.id)) : config.clips,
    langs: langs?.length ? config.langs.filter(lang => langs.includes(lang)) : config.langs,
  };
}

/**
 * Record every selected clip in every selected language: a fresh app per clip, the steps on the clip's frame clock,
 * each unique screen rendered once, framed like the README images, and written as each of the clip's formats.
 */
export async function record(config: ResolvedConfig, options: RecordOptions = {}): Promise<RecordedClip[]> {
  if (!isTtyConfig(config)) throw new ShowcaseError(`Nothing to record: ${WEB_CLIPS_MESSAGE}.`);
  if (config.clips.length === 0) throw new ShowcaseError('Nothing to record: the config has no clips.');
  const { clips, langs } = selectClips(config, options.only, options.langs);
  return recordClips(config, clips, langs);
}

/**
 * `record` for a chosen list, with the engine as a parameter so tests can drive it without a PTY. A failed clip
 * fails alone; the others are still written, then the failures are thrown together.
 */
export async function recordClips(
  config: ResolvedTtyConfig,
  clips: ResolvedClip[],
  langs: string[],
  engine?: TtyEngine,
): Promise<RecordedClip[]> {
  // Loaded only here: they pull in the terminal engine (xterm and the PTY package).
  const tty = await import('./tty/index.js');
  const { startSession, closeSession } = await import('./tty/capture.js');
  const using: TtyEngine = engine ?? { openTtySession: tty.openTtySession, renderTtyScreen: tty.renderTtyScreen };
  // Fail before an app or a browser starts.
  tty.assertNodeRuntime();
  if (clips.some(clip => clip.formats.includes('mp4'))) requireFfmpeg();
  else log.info('MP4 skipped: no clip lists "mp4" in its formats (it needs ffmpeg on PATH).');

  const results: RecordedClip[] = [];
  const failures: string[] = [];
  const browser = await launchBrowser(config);
  try {
    // Every screen is rendered at the config's scale, and the renderer cannot change a context's scale.
    const context = await browser.newContext({ deviceScaleFactor: config.deviceScaleFactor });
    const page = await context.newPage();
    for (const lang of langs) {
      for (const clip of clips) {
        try {
          const session = await startSession(config, lang, using);
          let samples: ClipSample[];
          try {
            samples = await recordTimeline(session, clip, config.timeouts.shotMs);
          } finally {
            await closeSession(config, session);
          }
          const frames = await renderFrames(samples, clip, lang, config, using, page, browser);
          results.push(await writeClip(config, clip, lang, frames));
        } catch (error) {
          const message = (error as Error).message;
          failures.push(`${lang}/${clip.id}: ${message}`);
          log.error(`  FAIL  ${lang}/${clip.id}: ${message}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    throw new ShowcaseError(
      `${String(failures.length)} clip(s) failed (${String(results.length)} recorded):\n` +
        failures.map(failure => `  - ${failure}`).join('\n'),
    );
  }
  return results;
}

const sleep = (ms: number): Promise<void> => new Promise(done => setTimeout(done, Math.max(0, ms)));

function describePattern(pattern: string | RegExp): string {
  return typeof pattern === 'string' ? JSON.stringify(pattern) : String(pattern);
}

function matches(text: string, pattern: string | RegExp): boolean {
  if (typeof pattern === 'string') return text.includes(pattern);
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function screenNote(text: string): string {
  const trimmed = text.replace(/\n+$/, '');
  return trimmed ? `Last screen:\n${trimmed.replace(/^/gm, '  | ')}` : 'The screen was empty.';
}

/**
 * Run the clip's steps on its own clock and sample the screen once per tick (`1000 / fps` ms), merging a tick into
 * the previous sample when the screen is unchanged.
 *
 * Steps run in lockstep with the ticks, right after a sample, so a recording does not depend on how fast the
 * machine is: a key's effect shows from the next frame on (if the app redraws within one frame), a `keys` or
 * `type` step takes at least one frame, sleeps are rounded to whole frames, and `waitFor` looks at the sampled
 * frames. The recording ends `tailMs` after the last step, or at `durationMs`, whichever comes first.
 */
export async function recordTimeline(session: TtySession, clip: ResolvedClip, waitTimeoutMs: number): Promise<ClipSample[]> {
  const interval = 1000 / clip.fps;
  const tailTicks = Math.round(clip.tailMs / interval);
  const maxTicks = clip.durationMs === undefined ? Infinity : Math.max(1, Math.round(clip.durationMs / interval));
  let exitCode: number | null | undefined;
  void session.exited.then(code => {
    exitCode = code;
  });

  const samples: ClipSample[] = [];
  let stepIndex = 0;
  // The tick the current step started on, the tick the next step may run, and progress through a slow `type`.
  let stepStart = 0;
  let resumeAt = 0;
  let typed = 0;
  let waitSince: number | undefined;
  let doneAt: number | undefined;
  const next = (tick: number): void => {
    stepIndex++;
    stepStart = tick;
    typed = 0;
    waitSince = undefined;
  };

  /** Run the steps due at `tick`, after its sample. */
  const runDue = async (tick: number, screen: TtyScreen): Promise<void> => {
    while (stepIndex < clip.steps.length && tick >= resumeAt) {
      const step = clip.steps[stepIndex];
      if (!step) break;
      if ('sleep' in step) {
        resumeAt = tick + Math.round(step.sleep / interval);
        next(tick);
      } else if ('waitFor' in step) {
        if (!matches(screen.text, step.waitFor)) {
          waitSince ??= Date.now();
          if (Date.now() - waitSince > waitTimeoutMs) {
            throw new ShowcaseError(
              `Step ${String(stepIndex + 1)}: the waitFor text ${describePattern(step.waitFor)} did not appear within ` +
                `${String(waitTimeoutMs)}ms (timeouts.shotMs).\n${screenNote(screen.text)}`,
            );
          }
          return;
        }
        next(tick);
      } else if ('keys' in step) {
        await session.press(step.keys);
        next(tick);
        resumeAt = tick + 1;
      } else {
        const chars = Array.from(step.type);
        const delay = step.delayMs ?? 0;
        // Characters due by now, counted from the step's start on the clip clock.
        let due = chars.length;
        if (delay > 0) due = chars.filter((_, index) => Math.round((index * delay) / interval) <= tick - stepStart).length;
        if (due > typed) await session.type(chars.slice(typed, due).join(''));
        typed = due;
        if (typed < chars.length) return;
        next(tick);
        resumeAt = tick + 1;
      }
    }
    if (stepIndex >= clip.steps.length) doneAt ??= tick;
  };

  const start = performance.now();
  let tick = 0;
  for (; tick < maxTicks; tick++) {
    await sleep(start + tick * interval - performance.now());
    if (exitCode !== undefined) {
      throw new ShowcaseError(
        `The app exited (code ${String(exitCode)}) after ${String(Math.round(tick * interval))}ms of the recording.\n` +
          screenNote(session.screenText()),
      );
    }
    const screen = session.screen();
    const last = samples[samples.length - 1];
    if (last?.screen.key === screen.key) last.ticks++;
    else samples.push({ screen, ticks: 1 });
    if (doneAt === undefined) await runDue(tick, screen);
    if (doneAt !== undefined && tick >= doneAt + tailTicks) break;
  }
  if (tick >= maxTicks && stepIndex < clip.steps.length) {
    log.warn(
      `  clip ${clip.id}: durationMs (${String(clip.durationMs)}) ended the recording with ` +
        `${String(clip.steps.length - stepIndex)} step(s) not run.`,
    );
  }
  return samples;
}

/** Per-frame delays in whole milliseconds, rounded on the running total so the clip keeps its exact length. */
export function sampleDelays(samples: ClipSample[], fps: number): number[] {
  const interval = 1000 / fps;
  let ticks = 0;
  return samples.map(sample => {
    const start = Math.round(ticks * interval);
    ticks += sample.ticks;
    return Math.round(ticks * interval) - start;
  });
}

function clipTitle(config: ResolvedTtyConfig, clip: ResolvedClip, lang: string): string | undefined {
  if (config.frame.title === false || config.frame.style === 'none') return undefined;
  return fillTemplate(config.frame.title, { name: config.name, title: clip.title, id: clip.id, lang });
}

/** Render each unique screen once, frame it through one hole render, and pair it with its delay. */
async function renderFrames(
  samples: ClipSample[],
  clip: ResolvedClip,
  lang: string,
  config: ResolvedTtyConfig,
  engine: TtyEngine,
  page: Parameters<TtyEngine['renderTtyScreen']>[0],
  browser: Awaited<ReturnType<typeof launchBrowser>>,
): Promise<AnimationFrame[]> {
  const rendered = new Map<string, Buffer>();
  for (const { screen } of samples) {
    if (!rendered.has(screen.key)) {
      rendered.set(screen.key, await engine.renderTtyScreen(page, screen, config.terminal, config.deviceScaleFactor));
    }
  }
  const first = rendered.values().next().value;
  if (!first) throw new ShowcaseError('The recording has no frames.');
  const { width = 0, height = 0 } = await sharp(first).metadata();
  const hole = await renderFrameHole(browser, config, {
    cssWidth: Math.round(width / config.deviceScaleFactor),
    cssHeight: Math.round(height / config.deviceScaleFactor),
    title: clipTitle(config, clip, lang),
  });
  const { maxWidth } = config.frame;
  const framed = new Map<string, Buffer>();
  for (const [key, png] of rendered) {
    let image = await composeInHole(hole, png);
    if (maxWidth) {
      image = await sharp(image).resize({ width: maxWidth, withoutEnlargement: true }).png({ compressionLevel: 1 }).toBuffer();
    }
    framed.set(key, image);
  }
  const delays = sampleDelays(samples, clip.fps);
  return samples.map((sample, index) => ({ png: framed.get(sample.screen.key) ?? first, delayMs: delays[index] ?? 0 }));
}

const kb = (bytes: number): string => `${String(Math.round(bytes / 1024))} KB`;

async function writeClip(
  config: ResolvedTtyConfig,
  clip: ResolvedClip,
  lang: string,
  frames: AnimationFrame[],
): Promise<RecordedClip> {
  const files: RecordedFile[] = [];
  for (const format of clip.formats) {
    const data = await encodeAnimation(frames, { format });
    const path = clipPath(config, lang, clip.id, format);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    files.push({ format, path, bytes: data.length });
  }
  const { width = 0, height = 0 } = await sharp(frames[0]?.png).metadata();
  const durationMs = frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  log.info(
    `  ok    ${lang}/${clip.id}  ${String(width)}x${String(height)}  ${String(frames.length)} frame(s), ` +
      `${(durationMs / 1000).toFixed(1)} s  ${files.map(file => `${file.format} ${kb(file.bytes)}`).join(', ')}  ` +
      relative(process.cwd(), dirname(files[0]?.path ?? '.')),
  );
  return { lang, id: clip.id, width, height, frames: frames.length, durationMs, files };
}
