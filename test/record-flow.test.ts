import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTtyConfig, resolveConfig } from '../src/config/resolve.js';
import type { ResolvedClip, ResolvedTtyConfig, TtyConfig } from '../src/config/types.js';
import { ShowcaseError } from '../src/errors.js';
import { log } from '../src/log.js';
import { recordClips, recordTimeline, sampleDelays } from '../src/record.js';
import type { TtyEngine } from '../src/tty/capture.js';
import type { Keys, TtyScreen, TtySession, TtySessionOptions } from '../src/tty/types.js';
import { tempDir } from './helpers.js';

/** A scripted app: keys move between named screens, typed text is appended to the screen. */
class FakeSession implements TtySession {
  readonly pid = 100_000 + Math.floor(Math.random() * 1000);
  readonly exited: Promise<number | null>;
  closed = false;
  typed = '';
  private state = 'start';
  private exit!: (code: number | null) => void;

  constructor(
    readonly options: TtySessionOptions,
    private readonly moves: Record<string, Record<string, string>>,
    private readonly events: string[],
    exitAfterMs?: number,
  ) {
    this.exited = new Promise(resolve => (this.exit = resolve));
    if (exitAfterMs !== undefined) setTimeout(() => this.exit(3), exitAfterMs);
  }

  screenText(): string {
    return `screen ${this.state}${this.typed ? ` ${this.typed}` : ''}`;
  }

  screen(): TtyScreen {
    const text = this.screenText();
    return { cols: this.options.cols, rows: this.options.rows, text, key: text, grid: null };
  }

  async press(keys: Keys): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.events.push(`press ${key}`);
      this.state = this.moves[this.state]?.[key] ?? this.state;
    }
  }

  async type(text: string): Promise<void> {
    this.events.push(`type ${text}`);
    this.typed += text;
  }

  async waitForText(pattern: string | RegExp): Promise<void> {
    const text = this.screenText();
    if (typeof pattern === 'string' ? !text.includes(pattern) : !pattern.test(text)) {
      throw new ShowcaseError(`not on screen: ${String(pattern)}`);
    }
  }

  async resize(): Promise<void> {}

  async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async close(opts?: { quitKey?: string | false }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.events.push(`close ${String(opts?.quitKey)}`);
    this.exit(0);
  }
}

const MOVES = { start: { j: 'second' }, second: { j: 'third' } };

/** A distinct solid color per screen text, at the size the real renderer would produce. */
function fakeEngine(exitAfterMs?: number): { engine: TtyEngine; sessions: FakeSession[]; events: string[]; renders: string[] } {
  const sessions: FakeSession[] = [];
  const events: string[] = [];
  const renders: string[] = [];
  const engine: TtyEngine = {
    openTtySession: async options => {
      events.push('open');
      const session = new FakeSession(options, MOVES, events, exitAfterMs);
      sessions.push(session);
      return session;
    },
    renderTtyScreen: async (page, screen, look, deviceScaleFactor) => {
      renders.push(screen.text);
      const [r = 0, g = 0, b = 0] = createHash('sha256').update(screen.text).digest();
      const width = Math.round((screen.cols * 9 + look.padding * 2) * deviceScaleFactor);
      const height = Math.round((screen.rows * 20 + look.padding * 2) * deviceScaleFactor);
      return sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer();
    },
  };
  return { engine, sessions, events, renders };
}

function ttyConfig(overrides: Partial<TtyConfig> = {}): ResolvedTtyConfig {
  const input: TtyConfig = {
    name: 'Fake TUI',
    target: { mode: 'tty', command: ['fake-tui'], cols: 30, rows: 8, inputDelayMs: 0 },
    ready: 'screen',
    deviceScaleFactor: 1,
    shots: [{ id: 'still' }],
    clips: [{ id: 'tour', title: 'Tour', steps: [{ sleep: 300 }, { keys: 'j' }, { sleep: 200 }, { keys: 'j' }], tailMs: 1000 }],
    ...overrides,
  };
  const config = resolveConfig(input, tempDir());
  if (!isTtyConfig(config)) throw new Error('expected a tty config');
  return config;
}

function clip(overrides: Partial<ResolvedClip>): ResolvedClip {
  return { id: 'c', title: 'c', caption: undefined, alt: 'c', steps: [], fps: 10, durationMs: undefined, tailMs: 0, formats: ['webp'], ...overrides };
}

function session(): FakeSession {
  return new FakeSession({ command: 'x', cwd: '.', env: {}, cols: 30, rows: 8 }, MOVES, []);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('recordTimeline', () => {
  it('runs the steps on the frame clock and merges unchanged ticks, so an idle tail is one long frame', async () => {
    const samples = await recordTimeline(
      session(),
      clip({ steps: [{ sleep: 300 }, { keys: 'j' }, { sleep: 200 }, { keys: 'j' }], tailMs: 1000 }),
      1000,
    );
    // Keys run after the sample of their tick and show from the next one; the tail is 10 ticks of the last screen.
    expect(samples.map(sample => [sample.screen.text, sample.ticks])).toEqual([
      ['screen start', 4],
      ['screen second', 3],
      ['screen third', 10],
    ]);
    expect(sampleDelays(samples, 10)).toEqual([400, 300, 1000]);
  });

  it('types slowly on the clock and waits for text on the sampled frames', async () => {
    const samples = await recordTimeline(
      session(),
      clip({ steps: [{ type: 'abc', delayMs: 150 }, { waitFor: /abc$/ }, { keys: 'j' }], tailMs: 100 }),
      1000,
    );
    // Characters are due at 0, 150 and 300 ms, which the clock rounds to ticks 0, 2 and 3.
    expect(samples.map(sample => [sample.screen.text, sample.ticks])).toEqual([
      ['screen start', 1],
      ['screen start a', 2],
      ['screen start ab', 1],
      ['screen start abc', 1],
      ['screen second abc', 1],
    ]);
  });

  it('lets a trailing sleep run out before the tail', async () => {
    const samples = await recordTimeline(session(), clip({ steps: [{ keys: 'j' }, { sleep: 500 }], tailMs: 200 }), 1000);
    // The first frame, then 500 ms of sleep and 200 ms of tail on the new screen.
    expect(samples.map(sample => [sample.screen.text, sample.ticks])).toEqual([
      ['screen start', 1],
      ['screen second', 7],
    ]);
  });

  it('stops at durationMs even with steps left, and says so', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const samples = await recordTimeline(session(), clip({ steps: [{ sleep: 5000 }, { keys: 'j' }], durationMs: 500 }), 1000);
    expect(samples.map(sample => [sample.screen.text, sample.ticks])).toEqual([['screen start', 5]]);
    expect(warn).toHaveBeenCalledWith('  clip c: durationMs (500) ended the recording with 1 step(s) not run.');
  });

  it('keeps delays exact at a frame rate that does not divide a second', () => {
    const samples = [1, 2, 1, 3].map(ticks => ({ ticks, screen: session().screen() }));
    const delays = sampleDelays(samples, 3);
    expect(delays).toEqual([333, 667, 333, 1000]);
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(Math.round((7 * 1000) / 3));
  });
});

describe('recordClips, scripted engine', () => {
  it('writes a framed WebP and GIF with merged frames and exact delays, and closes the app', async () => {
    const config = ttyConfig();
    const { engine, sessions, events, renders } = fakeEngine();
    const [result] = await recordClips(config, config.clips, config.langs, engine);

    expect(events).toEqual(['open', 'press j', 'press j', 'close q']);
    expect(sessions[0]?.closed).toBe(true);
    // Each unique screen is rendered once.
    expect(renders).toEqual(['screen start', 'screen second', 'screen third']);
    // The terminal area (30 x 8 cells, 12px padding) in the window frame (40px bar, 72px padding) at DPR 1.
    const width = 30 * 9 + 24 + 144;
    const height = 8 * 20 + 24 + 40 + 144;
    expect(result).toMatchObject({ lang: 'en', id: 'tour', width, height, frames: 3, durationMs: 1700 });
    expect(result?.files.map(file => [file.format, file.path])).toEqual([
      ['webp', join(config.root, 'assets', 'showcase', 'en', 'tour.webp')],
      ['gif', join(config.root, 'assets', 'showcase', 'en', 'tour.gif')],
    ]);
    for (const file of result?.files ?? []) {
      const meta = await sharp(readFileSync(file.path), { animated: true }).metadata();
      expect([meta.format, meta.width, meta.pageHeight, meta.pages, meta.loop]).toEqual([file.format, width, height, 3, 0]);
      expect(meta.delay).toEqual([400, 300, 1000]);
      expect(file.bytes).toBe(readFileSync(file.path).length);
    }
    expect(existsSync(join(config.root, 'assets', 'showcase', 'en', 'tour.mp4'))).toBe(false);
  });

  it('starts a fresh app per clip and per language, and follows outputs.clips and frame.maxWidth', async () => {
    const config = ttyConfig({
      langs: ['en', 'pl'],
      outputs: { clips: 'clips/{slug}/{lang}-{id}.{ext}' },
      frame: { maxWidth: 300 },
      clips: [
        { id: 'one', steps: [{ keys: 'j' }], tailMs: 100, formats: ['gif'] },
        { id: 'two', steps: [{ sleep: 100 }], tailMs: 0, formats: ['webp'] },
      ],
    });
    const { engine, sessions } = fakeEngine();
    const results = await recordClips(config, config.clips, config.langs, engine);
    expect(sessions).toHaveLength(4);
    expect(sessions.every(item => item.closed)).toBe(true);
    expect(results.map(item => relativePaths(config.root, item.files.map(file => file.path)))).toEqual([
      ['clips/fake-tui/en-one.gif'],
      ['clips/fake-tui/en-two.webp'],
      ['clips/fake-tui/pl-one.gif'],
      ['clips/fake-tui/pl-two.webp'],
    ]);
    expect(results.every(item => item.width === 300)).toBe(true);
  });

  it('fails only the clip whose waitFor never shows, with the screen, closes its app and keeps the others', async () => {
    const config = ttyConfig({
      timeouts: { shotMs: 300 },
      clips: [
        { id: 'stuck', steps: [{ waitFor: 'never' }] },
        { id: 'fine', steps: [{ keys: 'j' }], tailMs: 0, formats: ['webp'] },
      ],
    });
    vi.spyOn(log, 'error').mockImplementation(() => {});
    const { engine, sessions } = fakeEngine();
    const error = await recordClips(config, config.clips, config.langs, engine).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(
      /^1 clip\(s\) failed \(1 recorded\):\n {2}- en\/stuck: Step 1: the waitFor text "never" did not appear within 300ms/,
    );
    expect((error as Error).message).toContain('Last screen:\n  | screen start');
    expect(sessions.map(item => item.closed)).toEqual([true, true]);
    expect(existsSync(join(config.root, 'assets', 'showcase', 'en', 'fine.webp'))).toBe(true);
  });

  it('says so when the app exits during the recording', async () => {
    const config = ttyConfig({ clips: [{ id: 'quits', steps: [{ sleep: 2000 }] }] });
    vi.spyOn(log, 'error').mockImplementation(() => {});
    const { engine, sessions } = fakeEngine(300);
    await expect(recordClips(config, config.clips, config.langs, engine)).rejects.toThrow(
      /en\/quits: The app exited \(code 3\) after \d+ms of the recording\./,
    );
    expect(sessions[0]?.closed).toBe(true);
  });

  it('asks for ffmpeg before starting anything when a clip wants MP4, and says MP4 is skipped otherwise', async () => {
    vi.stubEnv('PATH', tempDir('showcase-empty-path-'));
    const withMp4 = ttyConfig({ clips: [{ id: 'video', steps: [{ keys: 'j' }], formats: ['webp', 'mp4'] }] });
    const { engine, sessions } = fakeEngine();
    await expect(recordClips(withMp4, withMp4.clips, withMp4.langs, engine)).rejects.toThrow(/^MP4 needs ffmpeg on PATH/);
    expect(sessions).toHaveLength(0);

    const info = vi.spyOn(log, 'info').mockImplementation(() => {});
    const plain = ttyConfig({ clips: [{ id: 'plain', steps: [{ keys: 'j' }], tailMs: 0, formats: ['gif'] }] });
    await recordClips(plain, plain.clips, plain.langs, fakeEngine().engine);
    expect(info).toHaveBeenCalledWith('MP4 skipped: no clip lists "mp4" in its formats (it needs ffmpeg on PATH).');
  });

  it('closes the app and exits 130 on Ctrl+C during a recording', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(log, 'error').mockImplementation(() => {});
    const baseline = process.listenerCount('SIGINT');
    const config = ttyConfig({ clips: [{ id: 'long', steps: [{ sleep: 60_000 }] }] });
    const { engine, sessions } = fakeEngine();
    // Anything added after the app opens is the kit's listener; Playwright's own would really exit.
    let before: Function[] = [];
    const open = engine.openTtySession;
    engine.openTtySession = async options => {
      before = process.listeners('SIGINT');
      return open(options);
    };
    const run = recordClips(config, config.clips, config.langs, engine).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(sessions).toHaveLength(1), { timeout: 30_000 });
    await vi.waitFor(() => expect(process.listeners('SIGINT').filter(listener => !before.includes(listener))).toHaveLength(1));
    const [kit] = process.listeners('SIGINT').filter(listener => !before.includes(listener));
    kit?.('SIGINT');
    await vi.waitFor(() => expect(sessions[0]?.closed).toBe(true));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    // The app exited, which ends the recording with an error instead of a 60 s wait.
    expect(String(await run)).toMatch(/The app exited \(code 0\)/);
    expect(process.listenerCount('SIGINT')).toBe(baseline);
  });
});

function relativePaths(root: string, paths: string[]): string[] {
  return paths.map(path => path.slice(root.length + 1).split(/[\\/]/).join('/'));
}
