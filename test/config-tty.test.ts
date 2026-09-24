import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ConfigError,
  defineConfig,
  init,
  isTtyConfig,
  loadConfig,
  resolveConfig,
  starterConfig,
  type ResolvedConfig,
  type ResolvedTtyConfig,
  type TtySession,
} from '../src/index.js';
import { tempDir } from './helpers.js';

const minimal = {
  name: 'Rumi',
  target: { mode: 'tty', command: 'bun run src/index.tsx' },
  shots: [{ id: 'resources' }],
};

function ttyConfig(input: unknown, root = '/work/rumi'): ResolvedTtyConfig {
  const config: ResolvedConfig = resolveConfig(input, root);
  if (!isTtyConfig(config)) throw new Error('expected a tty config');
  return config;
}

function issuesOf(input: unknown, root = process.cwd()): string[] {
  try {
    resolveConfig(input, root);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('expected resolveConfig to throw');
}

describe('resolveConfig, tty mode', () => {
  it('fills the tty defaults', () => {
    const config = ttyConfig(minimal);
    expect(config.target).toEqual({
      mode: 'tty',
      command: 'bun run src/index.tsx',
      cwd: resolve('/work/rumi'),
      env: undefined,
      cols: 120,
      rows: 32,
      quitKey: 'q',
      inputDelayMs: 300,
      readyTimeoutMs: 30_000,
    });
    expect(config.shots).toEqual([
      {
        id: 'resources',
        title: 'resources',
        caption: undefined,
        alt: 'Rumi: resources',
        delayMs: 0,
        keys: undefined,
        nav: undefined,
        waitFor: undefined,
        restart: false,
      },
    ]);
    expect(config.ready).toBeUndefined();
    expect(config).not.toHaveProperty('viewport');
    expect(config.terminal).toMatchObject({ font: { size: 15 }, lineHeight: 1.32, padding: 12, cursor: 'hide' });
    expect(config.terminal.theme.ansi).toHaveLength(16);
    // Everything downstream of capture works as in the other modes.
    expect(config.outputs.raw).toBe('showcase-out/raw/{lang}/{id}.png');
    expect(config.frame.style).toBe('window');
  });

  it('keeps every tty option as given, and resolves cwd and font files against the root', () => {
    const root = tempDir();
    mkdirSync(join(root, 'fonts'));
    writeFileSync(join(root, 'fonts', 'Mono.woff2'), '');
    const env = ({ lang }: { lang: string }): Record<string, string> => ({ APP_LANG: lang });
    const nav = async (tty: TtySession): Promise<void> => {
      await tty.press('L');
    };
    const theme = {
      background: '#101010',
      foreground: '#eeeeee',
      cursor: '#ff00ff',
      ansi: Array.from({ length: 16 }, (_, index) => `#0000${index.toString(16).padStart(2, '0')}`),
    };
    const config = ttyConfig(
      {
        name: 'Rumi',
        target: {
          mode: 'tty',
          command: ['bun', 'run', 'src/index.tsx'],
          cwd: 'app',
          env,
          cols: 100,
          rows: 30,
          quitKey: false,
          inputDelayMs: 0,
          readyTimeoutMs: 5000,
        },
        ready: /resources \(\d+\)/g,
        terminal: { theme, font: { file: 'fonts/Mono.woff2', size: 14 }, lineHeight: 1.5, padding: 20, cursor: 'show' },
        timeouts: { shotMs: 4000 },
        shots: [
          { id: 'servers', keys: '{Tab}', waitFor: /servers/y, delayMs: 200 },
          { id: 'logs', keys: ['{Tab}', 'l'], waitFor: 'logs', restart: true },
          { id: 'deploy', nav },
        ],
      },
      root,
    );
    expect(config.target).toMatchObject({
      command: ['bun', 'run', 'src/index.tsx'],
      cwd: join(root, 'app'),
      env,
      cols: 100,
      rows: 30,
      quitKey: false,
      inputDelayMs: 0,
      readyTimeoutMs: 5000,
    });
    // g and y flags keep state between tests; the kit polls the screen, so they are dropped.
    expect(config.ready).toEqual(/resources \(\d+\)/);
    expect(config.shots.map(shot => [shot.id, shot.keys, shot.waitFor, shot.restart, shot.delayMs])).toEqual([
      ['servers', '{Tab}', /servers/, false, 200],
      ['logs', ['{Tab}', 'l'], 'logs', true, 0],
      ['deploy', undefined, undefined, false, 0],
    ]);
    expect(config.shots[2]?.nav).toBe(nav);
    expect(config.timeouts.shotMs).toBe(4000);
    expect(config.terminal).toMatchObject({
      theme,
      font: { file: join(root, 'fonts', 'Mono.woff2'), size: 14 },
      lineHeight: 1.5,
      padding: 20,
      cursor: 'show',
    });
  });

  it('rejects web-only keys and bad tty values, all at once', () => {
    const root = tempDir();
    const issues = issuesOf(
      {
        name: 'Rumi',
        target: { mode: 'tty', url: 'http://localhost', start: 'bun dev', env: ['A=1'], cols: 4, quitKey: '' },
        viewport: { width: 800, height: 600 },
        colorScheme: 'light',
        css: 'body {}',
        timeouts: { readyMs: 1000, networkIdleMs: 0 },
        terminal: {
          theme: { background: '#000', foreground: 'red; }', ansi: ['#fff'] },
          font: { file: 'missing.woff2', boldFile: 'bold.eot', size: 200 },
          cursor: 'blink',
          padding: -1,
          ligatures: true,
        },
        shots: [
          { id: 'a', nav: '/settings' },
          { id: 'b', keys: 'x', nav: async () => {} },
          { id: 'c', keys: [], restart: 'yes' },
          { id: 'd', waitFor: 42 },
        ],
      },
      root,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        'config.viewport: not used in tty mode (the image size comes from target.cols, target.rows, terminal.font.size and terminal.padding)',
        'config.colorScheme: not used in tty mode (set terminal.theme)',
        'config.css: not used in tty mode',
        'target.url: not used in tty mode (the kit runs target.command in a terminal)',
        'target.start: not used in tty mode (target.command starts the app)',
        'target.command: is required',
        'target.env: must be an object of string values, or a function ({ lang }) => ({ ... })',
        'target.cols: must be an integer between 10 and 500, got number 4',
        'target.quitKey: must be a non-empty string, got ""',
        'timeouts.readyMs: not used in tty mode (set target.readyTimeoutMs)',
        'timeouts.networkIdleMs: not used in tty mode',
        'terminal.theme.background: must be a #rrggbb color, got "#000"',
        'terminal.theme.foreground: must be a #rrggbb color, got "red; }"',
        'terminal.theme.ansi: must be an array of exactly 16 #rrggbb colors (8 normal, then 8 bright), got an array',
        `terminal.font.file: file not found: ${join(root, 'missing.woff2')}`,
        'terminal.font.boldFile: must be a .woff2, .woff, .ttf, .otf file, got "bold.eot"',
        'terminal.font.size: must be a number between 6 and 96, got number 200',
        'terminal.cursor: must be one of "hide", "show", got "blink"',
        'terminal.padding: must be an integer between 0 and 400, got number -1',
        expect.stringMatching(/^terminal\.ligatures: unknown key/),
        expect.stringMatching(/^shots\[0\]\.nav: must be a function of the terminal session in tty mode/),
        'shots[1].nav: cannot be combined with keys: press the keys inside nav instead',
        expect.stringMatching(/^shots\[2\]\.keys: must be a non-empty string or array of strings/),
        'shots[2].restart: must be true or false, got "yes"',
        'shots[3].waitFor: must be a non-empty string, got number 42',
      ]),
    );
    expect(issues).toHaveLength(25);
  });

  it('rejects a command that is neither a string nor [file, ...args]', () => {
    expect(issuesOf({ ...minimal, target: { mode: 'tty', command: [] } })).toEqual([
      'target.command: must be a command string or an array [file, ...args] of strings, got an empty array',
    ]);
    expect(issuesOf({ ...minimal, target: { mode: 'tty', command: ['node', 1] } })).toEqual([
      'target.command: must be a command string or an array [file, ...args] of strings, got an array',
    ]);
  });
});

describe('resolveConfig, tty-only keys in url and cdp mode', () => {
  it('says which keys belong to tty mode', () => {
    const issues = issuesOf({
      name: 'Web',
      target: { mode: 'url', url: 'http://localhost:5173', command: 'vite', cols: 80 },
      ready: /Ready/,
      terminal: { theme: 'dark' },
      shots: [{ id: 'home', keys: '{Tab}', restart: true, waitFor: /Home/ }],
    });
    expect(issues).toEqual([
      'config.terminal: only used in tty mode',
      'shots[0].keys: only used in tty mode',
      'shots[0].restart: only used in tty mode',
      'shots[0].waitFor: must be a selector string in url and cdp mode (a RegExp is screen text, for tty mode)',
      'target.command: only used in tty mode',
      'target.cols: only used in tty mode',
      'ready: must be a selector string in url and cdp mode (a RegExp is screen text, for tty mode)',
    ]);
  });
});

describe('defineConfig types', () => {
  it('gives tty setups and navs the terminal session, and web ones the page', () => {
    const tty = defineConfig({
      name: 'Rumi',
      target: { mode: 'tty', command: ['bun', 'run', 'src/index.tsx'] },
      ready: /resources/,
      setup: async ({ tty: session, lang }) => {
        expectTypeOf(session).toEqualTypeOf<TtySession>();
        expectTypeOf(lang).toEqualTypeOf<string>();
        await session.press('{Tab}');
      },
      shots: [
        { id: 'servers', keys: '{Tab}', waitFor: /servers/ },
        {
          id: 'deploy',
          nav: async session => {
            expectTypeOf(session).toEqualTypeOf<TtySession>();
            await session.waitForText('Deploying');
          },
        },
      ],
    });
    expect(tty.target.mode).toBe('tty');

    const web = defineConfig({
      name: 'Web',
      target: { mode: 'url', url: 'http://localhost:5173' },
      setup: async ({ page }) => {
        expectTypeOf(page).toEqualTypeOf<Page>();
        await Promise.resolve();
      },
      shots: [{ id: 'home', nav: async page => void expectTypeOf(page).toEqualTypeOf<Page>() }],
    });
    expect(web.target.mode).toBe('url');

    defineConfig({
      name: 'Web',
      target: { mode: 'url', url: 'http://localhost:5173' },
      // @ts-expect-error `keys` is a tty mode shot option
      shots: [{ id: 'home', keys: '{Tab}' }],
    });
    defineConfig({
      name: 'Rumi',
      target: { mode: 'tty', command: 'rumi' },
      // @ts-expect-error `viewport` is not a tty mode option
      viewport: { width: 800, height: 600 },
      shots: [{ id: 'home' }],
    });
  });
});

describe('init --tty', () => {
  it('writes a starter tty config that runs the package bin and validates', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@acme/rumi', bin: { rumi: 'dist/cli.js' } }));
    const path = init(dir, { tty: true });
    const text = readFileSync(path, 'utf8');
    expect(text).toContain("mode: 'tty'");
    expect(text).toContain(`command: ['node', "dist/cli.js"],`);
    expect(text).toContain('pnpm add -D @lydell/node-pty');
    // Validate it as the kit would load it, minus the package import.
    writeFileSync(path, text.replace("import { defineConfig } from '@noctcore/showcase-kit';", 'const defineConfig = c => c;'));
    const config = await loadConfig(undefined, dir);
    if (!isTtyConfig(config)) throw new Error('expected a tty config');
    expect(config.name).toBe('Rumi');
    expect(config.target).toMatchObject({ command: ['node', 'dist/cli.js'], cwd: dir, cols: 120, rows: 32 });
    expect(config.shots.map(shot => shot.id)).toEqual(['home']);
  });

  it('falls back to a start script, then to node index.js', () => {
    const dir = tempDir();
    expect(starterConfig(dir, true, { tty: true })).toContain("command: 'node index.js',");
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tui', scripts: { start: 'bun src/index.tsx' } }));
    writeFileSync(join(dir, 'bun.lock'), '');
    const text = starterConfig(dir, true, { tty: true });
    expect(text).toContain("command: 'bun run start',");
    expect(text).not.toContain('@ts-check');
  });

  it('is what `showcase init --tty` writes', () => {
    const dir = tempDir();
    const result = spawnSync(process.execPath, [resolve('dist', 'cli.js'), 'init', '--tty'], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, 'showcase.config.mjs'), 'utf8')).toBe(starterConfig(dir, false, { tty: true }));
  });
});
