import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTtyConfig, resolveConfig } from '../src/config/resolve.js';
import type { ResolvedTtyConfig, TtyConfig } from '../src/config/types.js';
import { ShowcaseError } from '../src/errors.js';
import { log } from '../src/log.js';
import { captureTty, type TtyEngine } from '../src/tty/capture.js';
import type { Keys, TtyScreen, TtySession, TtySessionOptions } from '../src/tty/types.js';
import { capture } from '../src/capture.js';
import { frame } from '../src/frame/index.js';
import { FIXTURES, isAlive, tempDir } from './helpers.js';

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
  /** The PID the session reports. 0 is a Windows app ConPTY has not connected yet. Default a random fake one. */
  pid?: number;
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
    this.pid = app.pid ?? 100_000 + Math.floor(Math.random() * 1000);
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
    // Like the real engine, which flushes pending output into the grid before every look at the screen.
    await new Promise(resolve => setTimeout(resolve, 0));
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

  it('passes inheritEnv to the session, inheriting everything by default', async () => {
    const cases: Array<[TtyConfig['target'], boolean | string[]]> = [
      [{ mode: 'tty', command: 'fake-tui', inputDelayMs: 0 }, true],
      [{ mode: 'tty', command: 'fake-tui', inputDelayMs: 0, inheritEnv: false }, false],
      [{ mode: 'tty', command: 'fake-tui', inputDelayMs: 0, inheritEnv: ['HOME'] }, ['HOME']],
    ];
    for (const [target, expected] of cases) {
      const config = ttyConfig({ target, shots: [{ id: 'resources' }] });
      const { engine, recorder } = fakeEngine(APP);
      await captureTty(config, config.shots, config.langs, engine);
      expect(recorder.sessions[0]?.options.inheritEnv).toEqual(expected);
    }
  });

  it('captures an app that prints its screen and exits before the wait looks at it', async () => {
    // The exit is observed before the flush that would show the text: the race alone would call it "exited before".
    const config = ttyConfig({ shots: [{ id: 'resources' }] });
    const { engine, recorder } = fakeEngine({ ...APP, boot: '', drawAfterMs: 0, exitAfterMs: 0 });
    const { files, failures } = await captureTty(config, config.shots, config.langs, engine);
    expect(failures).toEqual([]);
    expect(files.map(file => file.id)).toEqual(['resources']);
    expect(recorder.rendered.map(render => render.text)).toEqual(['resources (3)']);
  });

  it('closes an app without a PID from the exit handler instead of skipping it', async () => {
    const config = ttyConfig({ ready: 'never ready', target: { mode: 'tty', command: 'fake-tui', readyTimeoutMs: 60_000 } });
    const { engine, recorder } = fakeEngine({ ...APP, pid: 0 });
    const events = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP'];
    const listeners = (event: string): Function[] => process.listeners(event as NodeJS.Signals);
    let before = new Map<string, Function[]>();
    const open = engine.openTtySession;
    engine.openTtySession = async options => {
      before = new Map(events.map(event => [event, listeners(event)]));
      return open(options);
    };
    const added = (event: string): Function[] => listeners(event).filter(listener => !before.get(event)?.includes(listener));
    const run = captureTty(config, config.shots, config.langs, engine).catch((caught: unknown) => caught);
    try {
      await vi.waitFor(() => expect(recorder.sessions).toHaveLength(1), { timeout: 30_000 });
      await vi.waitFor(() => expect(added('exit')).toHaveLength(1));
      // Tracked although it has no PID: the handler that runs as the host exits closes its terminal.
      (added('exit')[0] as () => void)();
      expect(recorder.sessions[0]?.closed).toBe(true);
      expect(String(await run)).toMatch(/The app exited \(code 0\)/);
    } finally {
      // The handler cleared the kit's list as a real exit would, so its listeners are left to remove here.
      for (const event of events) for (const listener of added(event)) process.off(event as NodeJS.Signals, listener as () => void);
    }
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
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const config = ttyConfig({ ready: 'never ready', target: { mode: 'tty', command: 'fake-tui', readyTimeoutMs: 60_000 } });
    const { engine, recorder } = fakeEngine(APP);
    // The session opens after the browser has launched (and Playwright has added its own SIGINT handler), so any
    // listener added after this snapshot is the kit's. Only that one is called: Playwright's would really exit.
    let before: Function[] = [];
    const open = engine.openTtySession;
    engine.openTtySession = async options => {
      before = process.listeners('SIGINT');
      return open(options);
    };
    const run = captureTty(config, config.shots, config.langs, engine).catch((caught: unknown) => caught);
    await vi.waitFor(() => expect(recorder.sessions).toHaveLength(1), { timeout: 30_000 });
    await vi.waitFor(() =>
      expect(process.listeners('SIGINT').filter(listener => !before.includes(listener))).toHaveLength(1),
    );
    const [kit] = process.listeners('SIGINT').filter(listener => !before.includes(listener));

    kit?.('SIGINT');
    expect(warn).toHaveBeenCalledWith('\nReceived SIGINT, closing the terminal app.');
    // Only the kit's handler knows the session; without it the app would wait 60 s for its ready text.
    await vi.waitFor(() => expect(recorder.sessions[0]?.closed).toBe(true));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    // Closing made the app exit, which ends the ready wait.
    expect(String(await run)).toMatch(/The app exited \(code 0\)/);
    expect(process.listenerCount('SIGINT')).toBe(baseline);
  });

  it('without ready, waits for the first drawing before the first shot', async () => {
    const config = ttyConfig({ ready: undefined, target: { mode: 'tty', command: 'fake-tui', inputDelayMs: 0 } });
    const { engine, recorder } = fakeEngine({ ...APP, boot: '', drawAfterMs: 300 });
    await captureTty(config, config.shots.slice(0, 1), config.langs, engine);
    expect(recorder.rendered.map(render => render.text)).toEqual(['resources (3)']);
  });

  it('says so when an app without ready never draws anything', async () => {
    const config = ttyConfig({ ready: undefined, target: { mode: 'tty', command: 'fake-tui', readyTimeoutMs: 200 } });
    const { engine } = fakeEngine({ ...APP, boot: '', drawAfterMs: 60_000 });
    await expect(captureTty(config, config.shots, config.langs, engine)).rejects.toThrow(
      /^Any text \(no ready is set\) did not appear within 200ms .*\nThe screen was empty\.$/,
    );
  });
});

const TUI = join(FIXTURES, 'tui.mjs');

/** The fixture TUI from the engine tests, run directly by this Node. */
function fixtureTty(root: string, overrides: Partial<TtyConfig> = {}): ResolvedTtyConfig {
  const input: TtyConfig = {
    name: 'Fixture TUI',
    target: { mode: 'tty', command: [process.execPath, TUI], cols: 80, rows: 24 },
    ready: 'fixture-tui · services',
    deviceScaleFactor: 1,
    shots: [
      { id: 'services', title: 'Services' },
      { id: 'moved', keys: 'jj', waitFor: 'selected postgres-main' },
      { id: 'details', keys: '{Tab}', waitFor: 'name: postgres-main' },
    ],
    ...overrides,
  };
  const config = resolveConfig(input, root);
  if (!isTtyConfig(config)) throw new Error('expected a tty config');
  return config;
}

describe('capture, tty mode, real terminal', () => {
  it('captures the fixture TUI: one PNG per shot at the terminal size, deterministic across runs', async () => {
    const root = tempDir();
    const config = fixtureTty(root);
    const first = await capture(config);
    expect(first.files.map(file => file.id)).toEqual(['services', 'moved', 'details']);
    for (const file of first.files) {
      // 80 x 24 cells of 9 x 20 CSS pixels (JetBrains Mono at 15px) plus 12px padding on each side, at DPR 1.
      expect([file.width, file.height]).toEqual([80 * 9 + 24, 24 * 20 + 24]);
    }
    const bytes = first.files.map(file => readFileSync(file.path).toString('base64'));
    // Every key changed the screen, so every capture differs.
    expect(new Set(bytes).size).toBe(3);

    const again = await capture(config);
    expect(again.files.map(file => readFileSync(file.path).toString('base64'))).toEqual(bytes);
  });

  it('scales with deviceScaleFactor, restarts on request, and leaves no process behind', async () => {
    const root = tempDir();
    const pids: number[] = [];
    const grab = async (tty: TtySession): Promise<void> => {
      await tty.waitForText(/grandchild \d+/);
      pids.push(Number(/grandchild (\d+)/.exec(tty.screenText())?.[1]));
    };
    const config = fixtureTty(root, {
      target: { mode: 'tty', command: [process.execPath, TUI], cols: 60, rows: 16, env: { TUI_GRANDCHILD: '1' } },
      deviceScaleFactor: 2,
      shots: [
        { id: 'first', nav: grab },
        { id: 'second', nav: grab, restart: true },
      ],
    });
    const { files } = await capture(config);
    expect(files.map(file => [file.width, file.height])).toEqual([
      [(60 * 9 + 24) * 2, (16 * 20 + 24) * 2],
      [(60 * 9 + 24) * 2, (16 * 20 + 24) * 2],
    ]);
    // A restart is a new process with its own grandchild; after the run both trees are gone.
    expect(pids).toHaveLength(2);
    expect(pids[0]).not.toBe(pids[1]);
    for (const pid of pids) {
      await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 });
    }
  });

  it('fails a shot whose waitFor never shows, with the screen in the error, and keeps the others', async () => {
    const root = tempDir();
    const config = fixtureTty(root, {
      timeouts: { shotMs: 1500 },
      shots: [
        { id: 'missing', keys: 'j', waitFor: 'no such text' },
        { id: 'details', keys: '{Tab}', waitFor: 'name: billing-worker' },
      ],
    });
    const error = await capture(config).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/^1 shot\(s\) failed \(1 captured\):/);
    expect((error as Error).message).toContain('en/missing: The waitFor text "no such text" did not appear within 1500ms');
    expect((error as Error).message).toContain('fixture-tui · services');
    expect(existsSync(join(root, 'showcase-out', 'raw', 'en', 'details.png'))).toBe(true);
  });

  it.each([
    ['with ready', 'print-exit done'],
    ['without ready', undefined],
  ])('captures a CLI that prints and exits 0 at once, %s', async (_, ready) => {
    const root = tempDir();
    const config = fixtureTty(root, {
      target: { mode: 'tty', command: [process.execPath, join(FIXTURES, 'print-exit.mjs'), 'one'], cols: 40, rows: 6 },
      ready,
      shots: [{ id: 'done' }],
    });
    const { files } = await capture(config);
    expect(files.map(file => [file.id, file.width, file.height])).toEqual([['done', 40 * 9 + 24, 6 * 20 + 24]]);
  });

  it('frames a terminal capture like any other raw capture', async () => {
    const root = tempDir();
    const config = fixtureTty(root, { shots: [{ id: 'services' }] });
    await capture(config);
    const [framed] = await frame(config);
    const meta = await sharp(framed!.path).metadata();
    // The raw terminal area plus the window bar (40) and the frame padding (72) on each side, at DPR 1.
    expect([meta.width, meta.height, meta.format]).toEqual([80 * 9 + 24 + 144, 24 * 20 + 24 + 40 + 144, 'webp']);
  });

  it('runs `showcase all` from the built CLI with a tty config', async () => {
    const dir = tempDir();
    const index = pathToFileURL(resolve('dist', 'index.js')).href;
    writeFileSync(
      join(dir, 'showcase.config.mjs'),
      `import { defineConfig } from '${index}';
export default defineConfig({
  name: 'Fixture TUI',
  target: { mode: 'tty', command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(TUI)}], cols: 70, rows: 20 },
  ready: 'fixture-tui',
  shots: [{ id: 'services' }, { id: 'details', keys: '{Tab}', waitFor: 'Details' }],
});
`,
    );
    const result = await new Promise<{ code: number | null; stderr: string }>((done, fail) => {
      const child = spawn(process.execPath, [resolve('dist', 'cli.js'), 'all'], { cwd: dir });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', fail);
      child.on('close', code => done({ code, stderr }));
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(readdirSync(join(dir, 'showcase-out', 'raw', 'en')).sort()).toEqual(['details.png', 'services.png']);
    expect(readdirSync(join(dir, 'assets', 'showcase', 'en')).sort()).toEqual(['details.webp', 'services.webp']);
    const meta = await sharp(join(dir, 'showcase-out', 'raw', 'en', 'services.png')).metadata();
    expect([meta.width, meta.height]).toEqual([(70 * 9 + 24) * 2, (20 * 20 + 24) * 2]);
  });
});
