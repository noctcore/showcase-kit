import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { launchBrowser } from './browser.js';
import { DEFAULT_CLIP_DURATION_MS, DEFAULT_MAX_FRAMES, WEB_CLIPS_MESSAGE } from './config/clips.js';
import { isTtyConfig } from './config/resolve.js';
import type { ClipFormat, ResolvedClip, ResolvedConfig, ResolvedTtyConfig } from './config/types.js';
import { encodeAnimation, requireFfmpeg, type AnimationFrame } from './encode.js';
import { ShowcaseError } from './errors.js';
import { composeInHole, renderFrameHole, type FrameHole } from './frame/render.js';
import { log } from './log.js';
import { fillTemplate } from './template.js';
import { trimTrailing } from './text.js';
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
 * Split `--only` into shot ids and clip ids, for commands that handle both (`all`, `readme`). Without clips the ids
 * all go to the shots unchanged, so unknown ids fail there as before. An empty list means that kind was not chosen.
 */
export function splitIds(config: ResolvedConfig, only: string[] | undefined): { shots?: string[]; clips?: string[] } {
  if (!only?.length || !isTtyConfig(config) || config.clips.length === 0) return { shots: only };
  const shots = only.filter(id => config.shots.some(shot => shot.id === id));
  const clips = only.filter(id => config.clips.some(clip => clip.id === id));
  const unknown = only.filter(id => !shots.includes(id) && !clips.includes(id));
  if (unknown.length > 0) {
    throw new ShowcaseError(
      `Unknown shot or clip id(s): ${unknown.join(', ')}. Shots: ${config.shots.map(shot => shot.id).join(', ')}; ` +
        `clips: ${config.clips.map(clip => clip.id).join(', ')}`,
    );
  }
  return { shots, clips };
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
          const frames = await recordFrames(config, clip, lang, using, page, browser);
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

/** Start a fresh app, record the clip, close the app, and render the frames. The samples are dropped on return. */
async function recordFrames(
  config: ResolvedTtyConfig,
  clip: ResolvedClip,
  lang: string,
  engine: TtyEngine,
  page: Parameters<TtyEngine['renderTtyScreen']>[0],
  browser: Awaited<ReturnType<typeof launchBrowser>>,
): Promise<AnimationFrame[]> {
  const { startSession, closeSession } = await import('./tty/capture.js');
  const session = await startSession(config, lang, engine);
  let samples: ClipSample[];
  try {
    samples = await recordTimeline(session, clip, config.timeouts.shotMs);
  } finally {
    await closeSession(config, session);
  }
  return renderFrames(samples, clip, lang, config, engine, page, browser);
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
  const trimmed = trimTrailing(text, '\n');
  return trimmed ? `Last screen:\n${trimmed.replace(/^/gm, '  | ')}` : 'The screen was empty.';
}

/**
 * Run the clip's steps on its own clock and sample the screen once per tick (`1000 / fps` ms), merging a tick into
 * the previous sample when the screen is unchanged.
 *
 * Steps run in lockstep with the ticks, right after a sample, so a recording does not depend on how fast the
 * machine is: a key's effect shows from the next frame on (if the app redraws within one frame), a `keys` or
 * `type` step takes at least one frame, sleeps are rounded to whole frames, and `waitFor` looks at the sampled
 * frames. The recording ends `tailMs` after the last step, at `durationMs` (default 60 s) or at `maxFrames`,
 * whichever comes first; the last two warn.
 *
 * The app may exit once the steps are done: the clip then holds its last screen for the rest of the tail. A
 * `waitFor` still pending when it exits is checked against that last screen, so a CLI that prints and exits can be
 * recorded. Any other step left when it exits fails the recording.
 */
export async function recordTimeline(session: TtySession, clip: ResolvedClip, waitTimeoutMs: number): Promise<ClipSample[]> {
  const interval = 1000 / clip.fps;
  const tailTicks = Math.round(clip.tailMs / interval);
  const durationMs = clip.durationMs ?? DEFAULT_CLIP_DURATION_MS;
  const maxTicks = Math.max(1, Math.round(durationMs / interval));
  const maxFrames = clip.maxFrames ?? DEFAULT_MAX_FRAMES;
  let exitCode: number | null | undefined;
  void session.exited.then(code => {
    exitCode = code;
  });
  let exited = false;

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
  const exitError = (tick: number, text: string): ShowcaseError =>
    new ShowcaseError(
      `The app exited (code ${String(exitCode)}) after ${String(Math.round(tick * interval))}ms of the recording, ` +
        `before its steps were done (it may only exit in the tail, after the last step).\n${screenNote(text)}`,
    );

  /** Run the steps due at `tick`, after its sample. */
  const runDue = async (tick: number, screen: TtyScreen): Promise<void> => {
    while (stepIndex < clip.steps.length && tick >= resumeAt) {
      const step = clip.steps[stepIndex];
      if (!step) break;
      // Once the app is gone only a `waitFor` its last screen already shows can still pass.
      if (exited && !('waitFor' in step && matches(screen.text, step.waitFor))) throw exitError(tick, screen.text);
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
    // A trailing sleep still has to run out: the tail starts once the next step could have run.
    if (stepIndex >= clip.steps.length && tick >= resumeAt - 1) doneAt ??= tick;
    if (exited && doneAt === undefined) throw exitError(tick, screen.text);
  };

  const start = performance.now();
  let tick = 0;
  let capped = false;
  for (; tick < maxTicks; tick++) {
    await sleep(start + tick * interval - performance.now());
    if (exitCode !== undefined && !exited) {
      exited = true;
      // Parse what the app printed before it exited into the grid: a wait with no time left flushes, then checks.
      await session.waitForText('', { timeoutMs: 0 }).catch(() => {});
    }
    const screen = session.screen();
    const last = samples[samples.length - 1];
    if (last?.screen.key === screen.key) last.ticks++;
    else if (samples.length >= maxFrames) {
      capped = true;
      break;
    } else samples.push({ screen, ticks: 1 });
    if (doneAt === undefined) await runDue(tick, screen);
    if (exited && doneAt !== undefined) {
      // The screen cannot change any more: hold it for the rest of the tail without waiting it out.
      const end = Math.min(doneAt + tailTicks, maxTicks - 1);
      const held = samples[samples.length - 1];
      if (held && end > tick) held.ticks += end - tick;
      break;
    }
    if (doneAt !== undefined && tick >= doneAt + tailTicks) break;
  }
  const at = `after ${String(Math.round(tick * interval))}ms`;
  const left = clip.steps.length - stepIndex;
  const notRun = left > 0 ? ` with ${String(left)} step(s) not run` : '';
  if (capped) {
    log.warn(
      `  clip ${clip.id}: reached maxFrames (${String(maxFrames)} frames) ${at}, so the recording stopped there${notRun}. ` +
        `The frames so far are written. Raise clips[].maxFrames to record more; every distinct frame is held in ` +
        `memory until the clip is encoded.`,
    );
  } else if (tick >= maxTicks && stepIndex < clip.steps.length) {
    const limit = clip.durationMs === undefined ? `the default durationMs (${String(durationMs)})` : `durationMs (${String(durationMs)})`;
    log.warn(`  clip ${clip.id}: ${limit} ended the recording${notRun}.`);
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

/**
 * Render each unique screen once and frame it at once, through one hole render per clip, so only the framed PNG is
 * kept per screen. Each sample then becomes a frame with its delay. It empties `samples` as it goes, so each
 * screen's grid can be freed once its frame exists.
 */
async function renderFrames(
  samples: ClipSample[],
  clip: ResolvedClip,
  lang: string,
  config: ResolvedTtyConfig,
  engine: TtyEngine,
  page: Parameters<TtyEngine['renderTtyScreen']>[0],
  browser: Awaited<ReturnType<typeof launchBrowser>>,
): Promise<AnimationFrame[]> {
  const { maxWidth } = config.frame;
  const delays = sampleDelays(samples, clip.fps);
  const framed = new Map<string, Buffer>();
  let hole: FrameHole | undefined;
  const frames: AnimationFrame[] = [];
  for (let index = 0; samples.length > 0; index++) {
    const screen = samples.shift()?.screen;
    if (!screen) break;
    let image = framed.get(screen.key);
    if (!image) {
      const png = await engine.renderTtyScreen(page, screen, config.terminal, config.deviceScaleFactor);
      if (!hole) {
        const { width = 0, height = 0 } = await sharp(png).metadata();
        hole = await renderFrameHole(browser, config, {
          cssWidth: Math.round(width / config.deviceScaleFactor),
          cssHeight: Math.round(height / config.deviceScaleFactor),
          title: clipTitle(config, clip, lang),
        });
      }
      if (maxWidth) {
        const full = await composeInHole(hole, png, 1);
        image = await sharp(full).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
      } else {
        image = await composeInHole(hole, png);
      }
      framed.set(screen.key, image);
    }
    frames.push({ png: image, delayMs: delays[index] ?? 0 });
  }
  if (frames.length === 0) throw new ShowcaseError('The recording has no frames.');
  return frames;
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
