import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTtyConfig, resolveConfig } from '../src/config/resolve.js';
import type { ResolvedTtyConfig, TtyConfig } from '../src/config/types.js';
import { ShowcaseError } from '../src/errors.js';
import { log } from '../src/log.js';
import { captureTty, type TtyEngine } from '../src/tty/capture.js';
import type { Keys, TtyScreen, TtySession, TtySessionOptions } from '../src/tty/types.js';
import { tempDir } from './helpers.js';

/**
 * A scripted stand-in for the PTY engine: the "app" shows `screens[state]`, and keys move between states. It records
 * everything capture does to it, so the flow (order, restarts, closing) can be checked without a real terminal.
 */
interface FakeApp {
  /** Screen text per state. */
  screens: Record<string, string>;
  /** `state -> key -> next state`. */
  moves?: Record<string, Record<string, string>>;
  /** Text shown before the app has drawn. */
  boot?: string;
  /** Milliseconds before the first screen appears. */
  drawAfterMs?: number;
  /** Exit on its own this many milliseconds after start. */
  exitAfterMs?: number;
}

interface Recorder {
  events: string[];
  sessions: FakeSession[];
  rendered: { text: string; dpr: number; scale: number }[];
}

class FakeSession implements TtySession {
  readonly pid: number;
  readonly exited: Promise<number | null>;
  closed = false;
  private state = 'start';
  private drawn = false;
  private exit!: (code: number | null) => void;

  constructor(
    readonly options: TtySessionOptions,
    private readonly app: FakeApp,
    private readonly log: string[],
  ) {
    this.pid = 100_000 + Math.floor(Math.random() * 1000);
    this.exited = new Promise(resolve => (this.exit = resolve));
    setTimeout(() => (this.drawn = true), app.drawAfterMs ?? 0);
    if (app.exitAfterMs !== undefined) setTimeout(() => this.exit(3), app.exitAfterMs);
  }

  screenText(): string {
    return this.drawn ? (this.app.screens[this.state] ?? '') : (this.app.boot ?? '');
  }

  screen(): TtyScreen {
    const text = this.screenText();
    return { cols: this.options.cols, rows: this.options.rows, text, key: text, grid: null };
  }

  async press(keys: Keys): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.log.push(`press ${key}`);
      this.state = this.app.moves?.[this.state]?.[key] ?? this.state;
    }
  }

  async type(text: string): Promise<void> {
    this.log.push(`type ${text}`);
  }

  async waitForText(pattern: string | RegExp, opts: { timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (opts.timeoutMs ?? 5000);
    const found = (): boolean =>
      typeof pattern === 'string' ? this.screenText().includes(pattern) : pattern.test(this.screenText());
    while (!found()) {
      if (Date.now() > deadline) throw new ShowcaseError(`Timed out waiting for ${String(pattern)}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  async resize(): Promise<void> {}

  async sleep(ms: number): Promise<void> {
    this.log.push(`sleep ${String(ms)}`);
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async close(opts?: { quitKey?: string | false }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.log.push(`close ${String(opts?.quitKey)}`);
    this.exit(0);
  }
}

function fakeEngine(app: FakeApp): { engine: TtyEngine; recorder: Recorder } {
  const recorder: Recorder = { events: [], sessions: [], rendered: [] };
  const engine: TtyEngine = {
    openTtySession: async options => {
      recorder.events.push(`open ${options.env.APP_LANG ?? ''}`);
      const session = new FakeSession(options, app, recorder.events);
      recorder.sessions.push(session);
      return session;
    },
    renderTtyScreen: async (page, screen, look, deviceScaleFactor) => {
      const dpr = await page.evaluate(() => window.devicePixelRatio);
      recorder.rendered.push({ text: screen.text, dpr, scale: deviceScaleFactor });
      recorder.events.push(`render ${screen.text}`);
      const width = Math.round((screen.cols * 9 + look.padding * 2) * deviceScaleFactor);
      const height = Math.round((screen.rows * 20 + look.padding * 2) * deviceScaleFactor);
      return sharp({ create: { width, height, channels: 3, background: look.theme.background } }).png().toBuffer();
    },
  };
  return { engine, recorder };
}

const APP: FakeApp = {
  boot: 'loading...',
  drawAfterMs: 30,
  screens: {
    start: 'resources (3)',
    servers: 'servers (2)',
    logs: 'logs: 12 lines',
  },
  moves: { start: { '{Tab}': 'servers' }, servers: { l: 'logs', '{Tab}': 'start' } },
};

function ttyConfig(overrides: Partial<TtyConfig> = {}): ResolvedTtyConfig {
  const input: TtyConfig = {
    name: 'Fake TUI',
    target: { mode: 'tty', command: ['fake-tui'], cols: 40, rows: 10, inputDelayMs: 20 },
    ready: /resources \(\d+\)/,
    deviceScaleFactor: 2,
    shots: [
      { id: 'resources', title: 'Resources' },
      { id: 'servers', keys: '{Tab}', waitFor: 'servers' },
      {
        id: 'logs',
        nav: async tty => {
          await tty.press('l');
          await tty.waitForText('logs');
        },
      },
    ],
    ...overrides,
  };
  const config = resolveConfig(input, tempDir());
  if (!isTtyConfig(config)) throw new Error('expected a tty config');
  return config;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('captureTty, scripted engine', () => {
  it('runs one app per language, shots in order, and writes raw PNGs at the configured scale', async () => {
    const setups: string[] = [];
    const config = ttyConfig({
      langs: ['en', 'pl'],
      target: {
        mode: 'tty',
        command: ['fake-tui'],
        cols: 40,
        rows: 10,
        inputDelayMs: 20,
        quitKey: 'Q',
        env: ({ lang }) => ({ APP_LANG: lang }),
      },
      setup: ({ tty, lang, mode, config: resolved }) => {
        expect(tty.screenText()).toBe('resources (3)');
        setups.push(`${mode} ${lang} ${resolved.name}`);
      },
    });
    const { engine, recorder } = fakeEngine(APP);
    const { files, failures } = await captureTty(config, config.shots, config.langs, engine);

    expect(failures).toEqual([]);
    expect(setups).toEqual(['tty en Fake TUI', 'tty pl Fake TUI']);
    const perLang = [
      'sleep 20',
      'render resources (3)',
      'press {Tab}',
      'render servers (2)',
      'press l',
      'render logs: 12 lines',
      'close Q',
    ];
    expect(recorder.events).toEqual(['open en', ...perLang, 'open pl', ...perLang]);
    expect(recorder.sessions.map(session => [session.options.cwd, session.options.cols, session.options.rows])).toEqual([
      [config.root, 40, 10],
      [config.root, 40, 10],
    ]);
    // The renderer gets a page whose device scale factor already matches.
    expect(recorder.rendered.every(({ dpr, scale }) => dpr === 2 && scale === 2)).toBe(true);

    expect(files.map(file => `${file.lang}/${file.id}`)).toEqual([
      'en/resources',
      'en/servers',
      'en/logs',
      'pl/resources',
      'pl/servers',
      'pl/logs',
    ]);
    for (const file of files) {
      expect(file.path).toBe(join(config.root, 'showcase-out', 'raw', file.lang, `${file.id}.png`));
      // (40 * 9 + 2 * 12) x (10 * 20 + 2 * 12) CSS pixels at DPR 2.
      expect([file.width, file.height]).toEqual([768, 448]);
      const meta = await sharp(readFileSync(file.path)).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([768, 448, 'png']);
    }
  });

  it('starts a fresh app and runs setup again for a restart shot', async () => {
    let setups = 0;
    const config = ttyConfig({
      setup: () => {
        setups += 1;
      },
      shots: [
        { id: 'servers', keys: '{Tab}', waitFor: 'servers' },
        { id: 'fresh', restart: true },
      ],
    });
    const { engine, recorder } = fakeEngine(APP);
    const { files } = await captureTty(config, config.shots, config.langs, engine);
    expect(recorder.events).toEqual([
      'open ',
      'sleep 20',
      'press {Tab}',
      'render servers (2)',
      'close q',
      'open ',
      'sleep 20',
      'render resources (3)',
      'close q',
    ]);
    expect(setups).toBe(2);
    expect(files.map(file => file.id)).toEqual(['servers', 'fresh']);
  });

  it('waits for the screen to change after keys when there is no waitFor', async () => {
    const slow: FakeApp = { ...APP, moves: { start: { j: 'servers' } } };
    const config = ttyConfig({ shots: [{ id: 'moved', keys: 'j' }] });
    const { engine, recorder } = fakeEngine(slow);
    await captureTty(config, config.shots, config.langs, engine);
    expect(recorder.rendered.map(render => render.text)).toEqual(['servers (2)']);
  });

  it('fails only the shot whose waitFor never shows, with the screen, and still closes the app', async () => {
    const config = ttyConfig({
      timeouts: { shotMs: 200 },
      shots: [
        { id: 'missing', keys: 'x', waitFor: 'never there' },
        { id: 'servers', keys: '{Tab}', waitFor: 'servers' },
      ],
    });
    const { engine, recorder } = fakeEngine(APP);
    const { files, failures } = await captureTty(config, config.shots, config.langs, engine);
    expect(files.map(file => file.id)).toEqual(['servers']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^en\/missing: The waitFor text "never there" did not appear within 200ms/);
    expect(failures[0]).toContain('  | resources (3)');
    expect(recorder.sessions.every(session => session.closed)).toBe(true);
  });

  it('closes the app and shows the last screen when the ready text never appears', async () => {
    const config = ttyConfig({
      ready: 'never ready',
      target: { mode: 'tty', command: 'fake-tui', readyTimeoutMs: 150 },
    });
    const { engine, recorder } = fakeEngine(APP);
    const error = await captureTty(config, config.shots, config.langs, engine).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/^The ready text "never ready" did not appear within 150ms/);
    expect((error as Error).message).toContain('Last screen:\n  | resources (3)');
    expect(recorder.sessions).toHaveLength(1);
    expect(recorder.sessions[0]?.closed).toBe(true);
  });

  it('says so when the app exits before it is ready', async () => {
    const config = ttyConfig({ ready: 'never ready' });
    const { engine } = fakeEngine({ ...APP, exitAfterMs: 50 });
    await expect(captureTty(config, config.shots, config.langs, engine)).rejects.toThrow(
      /^The app exited \(code 3\) before the ready text "never ready" appeared\./,
    );
  });

  it('refuses an env function that does not return strings', async () => {
    // As a plain JS config would: resolveConfig cannot see what the function returns.
    const config = resolveConfig(
      {
        name: 'Fake TUI',
        target: { mode: 'tty', command: 'fake-tui', env: () => ({ PORT: 3000 }) },
        shots: [{ id: 'resources' }],
      },
      tempDir(),
    );
    if (!isTtyConfig(config)) throw new Error('expected a tty config');
    const { engine, recorder } = fakeEngine(APP);
    await expect(captureTty(config, config.shots, config.langs, engine)).rejects.toThrow(
      "target.env({ lang: 'en' }) must return an object of string values.",
    );
    expect(recorder.sessions).toHaveLength(0);
  });

  it('closes open apps and exits 130 on Ctrl+C, then removes its handlers', async () => {
    const baseline = process.listenerCount('SIGINT');
    // Playwright's own SIGINT handler also runs and exits 130 once its browser is closed.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const config = ttyConfig({ ready: 'never ready', target: { mode: 'tty', command: 'fake-tui', readyTimeoutMs: 60_000 } });
    const { engine, recorder } = fakeEngine(APP);
    const run = captureTty(config, config.shots, config.langs, engine).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(recorder.sessions).toHaveLength(1), { timeout: 30_000 });

    process.emit('SIGINT');
    expect(warn).toHaveBeenCalledWith('\nReceived SIGINT, closing the terminal app.');
    // Only the kit's handler knows the session; without it the app would wait 60 s for its ready text.
    await vi.waitFor(() => expect(recorder.sessions[0]?.closed).toBe(true));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    // Closing made the app exit, which ends the ready wait.
    expect(String(await run)).toMatch(/The app exited \(code 0\)/);
    expect(process.listenerCount('SIGINT')).toBe(baseline);
  });
});
