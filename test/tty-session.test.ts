import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Terminal } from '@xterm/headless';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowcaseError } from '../src/errors.js';
import { assertNodeRuntime, loadPty, ptyCommand, ttyEnv } from '../src/tty/pty.js';
import { openTtySession, snapshot } from '../src/tty/session.js';
import type { TtySession, TtySessionOptions } from '../src/tty/types.js';
import { FIXTURES, isAlive, tempDir } from './helpers.js';

// Record every tree kill the engine attempts, while still letting it happen.
const kills = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: ((command: string, args: readonly string[], options: object) => {
      if (command === 'taskkill') kills.list.push(`taskkill ${args.join(' ')}`);
      return actual.spawnSync(command, args, options);
    }) as typeof actual.spawnSync,
  };
});

function watchKills(pid: number): void {
  const original = process.kill.bind(process);
  vi.spyOn(process, 'kill').mockImplementation((target: number, signal?: string | number) => {
    if ((target === pid || target === -pid) && signal !== 0) kills.list.push(`kill ${String(target)} ${String(signal)}`);
    return original(target, signal);
  });
}

const TUI = join(FIXTURES, 'tui.mjs');
const sessions: TtySession[] = [];

async function open(overrides: Partial<TtySessionOptions> = {}): Promise<TtySession> {
  const session = await openTtySession({
    command: [process.execPath, TUI],
    cwd: FIXTURES,
    env: {},
    cols: 80,
    rows: 24,
    ...overrides,
  });
  sessions.push(session);
  return session;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(sessions.splice(0).map(session => session.close({ quitKey: false })));
  kills.list.length = 0;
});

async function waitUntil(check: () => boolean, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return true;
}

describe('openTtySession', () => {
  it('drives the app with keys and reads the grid', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui · services');
    expect(tty.pid).toBeGreaterThan(0);
    await tty.press('{Down}{Down}');
    await tty.waitForText('selected postgres-main');
    await tty.press(['{Tab}']);
    await tty.waitForText(/fixture-tui · details/);
    expect(tty.screenText()).toContain('name: postgres-main');
    const screen = tty.screen();
    expect(screen.cols).toBe(80);
    expect(screen.rows).toBe(24);
    expect(screen.text.split('\n')).toHaveLength(24);
    expect(screen.text).toBe(tty.screenText());
    // Trailing spaces are trimmed per row.
    expect(screen.text.split('\n').every(line => line === line.trimEnd())).toBe(true);
  });

  it('delivers the exact bytes of named keys', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    await tty.press('{F5}');
    await tty.waitForText('last key: ^[[15~');
    await tty.press('{C-a}');
    await tty.waitForText('last key: ^A');
    await tty.press('{A-x}');
    await tty.waitForText('last key: ^[x');
    await tty.type('k{');
    await tty.waitForText('last key: {');
  });

  it('sends a lone Esc apart from the next key, so it does not read as Alt', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    // Esc then a key, three times over: written back to back they would arrive as one read.
    await tty.press('{Esc}j{Esc}j{Esc}j');
    await tty.waitForText('selected redis-cache');
    expect(tty.screenText()).toContain('last key: j');
  });

  it('sends arrows in application cursor mode when the app turns it on', async () => {
    const tty = await open({ env: { TUI_APP_CURSOR: '1' } });
    await tty.waitForText('fixture-tui');
    await tty.press('{Down}');
    await tty.waitForText('selected billing-worker');
    expect(tty.screenText()).toContain('last key: ^[OB');
  });

  it('runs a string command through the shell', async () => {
    const tty = await open({ command: `node "${TUI}"`, env: { SHOWCASE_TTY_TEST: 'shell ok' } });
    await tty.waitForText('fixture-tui · services');
    await tty.press('j');
    await tty.waitForText('selected billing-worker');
  });

  it('gives a key that is equal for equal screens and changes with the content', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    const first = tty.screen();
    expect(tty.screen().key).toBe(first.key);
    await tty.press('j');
    await tty.waitForText('selected billing-worker');
    const second = tty.screen();
    expect(second.key).not.toBe(first.key);
    // Screens are copies: the first one still shows the old selection.
    expect(first.text).toContain('selected api-gateway');
  });

  it('resizes the terminal and the app sees it', async () => {
    const tty = await open();
    await tty.waitForText('size 80x24');
    await tty.resize(100, 30);
    await tty.waitForText('size 100x30');
    expect(tty.screen().cols).toBe(100);
    expect(tty.screen().text.split('\n')).toHaveLength(30);
  });

  it('times out with the screen in the error', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    const error = await tty.waitForText('never shown', { timeoutMs: 300 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/Timed out after 300ms waiting for "never shown"[\s\S]*fixture-tui/);
  });

  it('rejects a wait and a key press once the app has exited', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    await tty.press('q');
    expect(await tty.exited).toBe(0);
    await expect(tty.waitForText('never shown', { timeoutMs: 5_000 })).rejects.toThrow(/exited \(code 0\) before "never shown"/);
    await expect(tty.press('j')).rejects.toThrow(ShowcaseError);
  });

  it('turns a missing working directory into a ShowcaseError', async () => {
    await expect(open({ cwd: join(tempDir(), 'missing') })).rejects.toThrow(/working directory does not exist/);
  });

  it('reports a command that cannot start instead of crashing the host', async () => {
    // Depending on the platform the spawn itself fails, or the child exits at once: both must reject cleanly.
    const error = await open({ command: ['showcase-no-such-command-9f3a'] })
      .then(async tty => tty.waitForText('never', { timeoutMs: 10_000 }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/Could not start|exited/);
  }, 30_000);
});

describe('TtySession.close', () => {
  it('quits with the quit key and never kills a process that exited', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    watchKills(tty.pid);
    await tty.close();
    expect(await tty.exited).toBe(0);
    expect(kills.list).toEqual([]);
  });

  it('does not kill by PID after the app exited on its own', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    watchKills(tty.pid);
    await tty.press('q');
    expect(await tty.exited).toBe(0);
    await tty.close();
    await tty.close();
    expect(kills.list).toEqual([]);
  });

  it('kills the whole tree by PID when the app ignores its quit key', async () => {
    const tty = await open({ env: { TUI_GRANDCHILD: '1', TUI_IGNORE_QUIT: '1' } });
    await tty.waitForText(/grandchild \d+/);
    const grandchild = Number(/grandchild (\d+)/.exec(tty.screenText())?.[1]);
    expect(isAlive(tty.pid)).toBe(true);
    expect(isAlive(grandchild)).toBe(true);
    watchKills(tty.pid);
    const started = Date.now();
    await tty.close();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(kills.list).toHaveLength(1);
    expect(await waitUntil(() => !isAlive(tty.pid) && !isAlive(grandchild))).toBe(true);
    expect(await tty.exited).not.toBe(0);
  });

  it('can skip the quit key', async () => {
    const tty = await open();
    await tty.waitForText('fixture-tui');
    watchKills(tty.pid);
    await tty.close({ quitKey: false });
    expect(kills.list).toHaveLength(1);
    expect(await waitUntil(() => !isAlive(tty.pid))).toBe(true);
  });
});

describe('snapshot', () => {
  const write = (term: Terminal, data: string): Promise<void> => new Promise(done => term.write(data, done));

  it('keys equal content equally, and a hidden cursor does not count', async () => {
    const a = new Terminal({ cols: 20, rows: 4, allowProposedApi: true });
    const b = new Terminal({ cols: 20, rows: 4, allowProposedApi: true });
    await write(a, '\x1b[31mred\x1b[0m plain');
    await write(b, '\x1b[31mred\x1b[0m plain\x1b[3;5H');
    expect(snapshot(a, false).key).toBe(snapshot(b, false).key);
    expect(snapshot(a, true).key).not.toBe(snapshot(b, true).key);
    await write(b, '\x1b[1;1H\x1b[32mred');
    expect(snapshot(b, false).text).toBe(snapshot(a, false).text);
    expect(snapshot(b, false).key).not.toBe(snapshot(a, false).key);
  });
});

describe('pty loading', () => {
  it('gives an install hint when no PTY package is installed', async () => {
    const error = await loadPty(['@noctcore/showcase-no-such-pty', 'showcase-no-such-pty']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShowcaseError);
    expect((error as Error).message).toMatch(/add -D @lydell\/node-pty[\s\S]*node-pty/);
  });

  it('prefers @lydell/node-pty', async () => {
    const lydell = (await import('@lydell/node-pty')) as { spawn: unknown; default?: { spawn: unknown } };
    expect((await loadPty()).spawn).toBe(lydell.default?.spawn ?? lydell.spawn);
  });

  it('refuses the Bun runtime with "run with node"', () => {
    expect(() => assertNodeRuntime({ ...process.versions, bun: '1.4.2' })).toThrow(/Bun runtime: run with node/);
    expect(() => assertNodeRuntime(process.versions)).not.toThrow();
  });

  it('refuses the Bun runtime for real', () => {
    const script = join(tempDir(), 'bun-check.ts');
    const pty = pathToFileURL(resolve('src/tty/pty.ts')).href;
    writeFileSync(
      script,
      `import { loadPty } from '${pty}';\n` +
        `loadPty().then(() => console.log('loaded'), (error: Error) => console.log(error.name + ': ' + error.message));\n`,
    );
    const result = spawnSync('bun', [script], { encoding: 'utf8', shell: process.platform === 'win32' });
    expect(result.stdout).toMatch(/ShowcaseError: .*run with node/);
  });
});

describe('ttyEnv', () => {
  const base = { PATH: '/bin', CI: 'true', NO_COLOR: '1', TERM_PROGRAM: 'vscode', COLUMNS: '200', HOME: '/home/me' };

  it('sets the deterministic defaults and drops CI and terminal hints', () => {
    expect(ttyEnv({}, base, 'linux')).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
      TZ: 'UTC',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    });
  });

  it('lets the user override every default', () => {
    const env = ttyEnv({ TZ: 'Europe/Warsaw', CI: '1', TERM: 'xterm' }, base, 'linux');
    expect(env).toMatchObject({ TZ: 'Europe/Warsaw', CI: '1', TERM: 'xterm' });
  });

  it('compares names case-insensitively on Windows only', () => {
    const windows = ttyEnv({ tz: 'Asia/Tokyo' }, { Path: 'C:\\bin', ci: 'true', No_Color: '1' }, 'win32');
    expect(windows).toEqual(expect.objectContaining({ Path: 'C:\\bin', tz: 'Asia/Tokyo' }));
    expect(Object.keys(windows).filter(name => name.toUpperCase() === 'TZ')).toEqual(['tz']);
    expect(Object.keys(windows).map(name => name.toUpperCase())).not.toContain('CI');
    expect(Object.keys(windows).map(name => name.toUpperCase())).not.toContain('NO_COLOR');
    expect(ttyEnv({ tz: 'Asia/Tokyo' }, {}, 'linux')).toMatchObject({ TZ: 'UTC', tz: 'Asia/Tokyo' });
  });

  const DEFAULTS = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    TZ: 'UTC',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  };

  it('inherits only what a program needs to start when inheritEnv is off', () => {
    const secret = { ...base, GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'y' };
    expect(ttyEnv({ APP: '1' }, secret, 'linux', false)).toEqual({ PATH: '/bin', ...DEFAULTS, APP: '1' });
    expect(ttyEnv({}, secret, 'linux', [])).toEqual({ PATH: '/bin', ...DEFAULTS });
    const windows = {
      Path: 'C:\\bin',
      PATHEXT: '.EXE;.CMD',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      USERPROFILE: 'C:\\Users\\me',
      GITHUB_TOKEN: 'ghp_x',
    };
    expect(Object.keys(ttyEnv({}, windows, 'win32', false)).slice(0, 4)).toEqual(['Path', 'PATHEXT', 'SystemRoot', 'ComSpec']);
    expect(ttyEnv({}, windows, 'win32', false)).not.toHaveProperty('USERPROFILE');
    expect(ttyEnv({}, windows, 'win32', false)).not.toHaveProperty('GITHUB_TOKEN');
  });

  it('adds the listed names, case-insensitively on Windows only, but never CI and terminal hints', () => {
    expect(ttyEnv({}, base, 'linux', ['HOME', 'CI', 'MISSING'])).toEqual({ PATH: '/bin', HOME: '/home/me', ...DEFAULTS });
    expect(ttyEnv({}, base, 'linux', ['home'])).not.toHaveProperty('HOME');
    expect(ttyEnv({}, { Path: 'C:\\bin', UserProfile: 'C:\\Users\\me' }, 'win32', ['USERPROFILE'])).toMatchObject({
      Path: 'C:\\bin',
      UserProfile: 'C:\\Users\\me',
    });
  });
});

describe('inheritEnv in a real terminal', () => {
  const NAME = 'SHOWCASE_TTY_SECRET_TEST';
  const show = `process.stdout.write('secret=' + (process.env.${NAME} ?? 'unset') + ' done')`;

  afterEach(() => {
    delete process.env[NAME];
  });

  it.each([
    [true, 'secret=s3cret done'],
    [false, 'secret=unset done'],
    [[NAME], 'secret=s3cret done'],
  ])('with inheritEnv %j the app sees "%s", and still starts', async (inheritEnv, expected) => {
    process.env[NAME] = 's3cret';
    const tty = await open({ command: [process.execPath, '-e', show], inheritEnv });
    await tty.waitForText(' done');
    expect(await tty.exited).toBe(0);
    expect(tty.screenText()).toContain(expected);
  });
});

describe('ptyCommand', () => {
  it('runs a string through the shell', () => {
    expect(ptyCommand('bun run tui', {}, 'linux')).toEqual({ file: '/bin/sh', args: ['-c', 'bun run tui'] });
    expect(ptyCommand('bun run tui', { ComSpec: 'C:\\Windows\\cmd.exe' }, 'win32')).toEqual({
      file: 'C:\\Windows\\cmd.exe',
      args: '/d /s /c "bun run tui"',
    });
  });

  it('spawns an array directly, and wraps Windows .cmd shims in cmd.exe', () => {
    expect(ptyCommand(['bun', 'run', 'tui'], {}, 'linux')).toEqual({ file: 'bun', args: ['run', 'tui'] });
    const bin = tempDir();
    writeFileSync(join(bin, 'fake-pnpm.cmd'), '@echo off\r\n');
    writeFileSync(join(bin, 'fake-app.exe'), '');
    const env = { PATH: bin, PATHEXT: '.exe;.cmd' };
    expect(ptyCommand(['fake-pnpm', 'run', 'my tui'], env, 'win32')).toEqual({
      file: 'cmd.exe',
      args: `/d /v:off /s /c "${join(bin, 'fake-pnpm.cmd')} run "my tui""`,
    });
    expect(ptyCommand(['fake-app', '--x'], env, 'win32')).toEqual({ file: join(bin, 'fake-app.exe'), args: ['--x'] });
    expect(() => ptyCommand([] as unknown as [string], env, 'win32')).toThrow(/command is empty/);
  });

  it('quotes shim arguments for cmd.exe and refuses what it cannot pass', () => {
    const bin = tempDir();
    writeFileSync(join(bin, 'fake-pnpm.cmd'), '@echo off\r\n');
    const env = { PATH: bin, PATHEXT: '.cmd' };
    const shim = join(bin, 'fake-pnpm.cmd');
    expect(ptyCommand(['fake-pnpm', 'a&b', 'k=v,w;z', 'C:\\my dir\\', ''], env, 'win32').args).toBe(
      `/d /v:off /s /c "${shim} "a&b" "k=v,w;z" "C:\\my dir\\\\" """`,
    );
    for (const bad of ['100%', '%PATH%', 'say "hi"', 'two\nlines']) {
      expect(() => ptyCommand(['fake-pnpm', bad], env, 'win32')).toThrow(/cannot take a " or % in an argument/);
    }
    // Only shims go through cmd.exe: an .exe, or any command on POSIX, takes these as they are.
    expect(ptyCommand(['fake-pnpm', '100%', 'say "hi"'], env, 'linux').args).toEqual(['100%', 'say "hi"']);
  });

  it.runIf(process.platform === 'win32')('passes arguments through a real .cmd shim unchanged', async () => {
    const bin = tempDir();
    const script = join(FIXTURES, 'print-exit.mjs');
    writeFileSync(join(bin, 'echo-args.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    const args = ['a b', 'x&y|z', 'c^d', '<e>', 'f(g)', 'hi!PATH!', 'k=v,w;z', 'C:\\my dir\\', ''];
    const tty = await open({ command: ['echo-args', ...args], env: { PATH: `${bin};${process.env.PATH ?? ''}` }, cols: 200 });
    await tty.waitForText('print-exit done');
    expect(await tty.exited).toBe(0);
    expect(tty.screenText()).toContain(`args ${JSON.stringify(args)}`);
  });
});
