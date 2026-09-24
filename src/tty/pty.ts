import { existsSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import { ShowcaseError } from '../errors.js';

/** The part of the node-pty API the engine uses. `@lydell/node-pty` and `node-pty` both provide it. */
export interface PtyProcess {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  /** The Windows terminal is an EventEmitter that throws unhandled socket errors without a listener. */
  on?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface PtyModule {
  spawn(
    file: string,
    args: string[] | string,
    options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
  ): PtyProcess;
}

/** Tried in order: the prebuilt repackaging first, then the official package. */
export const PTY_PACKAGES = ['@lydell/node-pty', 'node-pty'] as const;

const INSTALL_HINT =
  'Terminal capture needs a pseudo terminal package. Install it next to the kit:\n' +
  '  pnpm add -D @lydell/node-pty   (or npm i -D / bun add -d)\n' +
  '`node-pty` works too when it is installed instead.';

/** Under the Bun runtime node-pty kills its child at once, so tty mode refuses to run there. */
export function assertNodeRuntime(versions: NodeJS.ProcessVersions = process.versions): void {
  if (versions.bun !== undefined) {
    throw new ShowcaseError(
      'Terminal capture does not work under the Bun runtime: run with node. ' +
        '`bunx showcase` already uses node; drop `--bun`, or run `npx showcase` / `node node_modules/.bin/showcase`.',
    );
  }
}

let cached: PtyModule | undefined;

function isMissing(error: unknown, name: string): boolean {
  const { code, message } = error as NodeJS.ErrnoException;
  // Only the package itself missing, not something it imports.
  return (
    (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
    (message.includes(`'${name}'`) || message.includes(`"${name}"`))
  );
}

/** Import the consumer's PTY package lazily, so nothing but tty mode needs a native dependency. */
export async function loadPty(candidates: readonly string[] = PTY_PACKAGES): Promise<PtyModule> {
  assertNodeRuntime();
  if (cached && candidates === PTY_PACKAGES) return cached;
  for (const name of candidates) {
    let mod: { default?: PtyModule } & Partial<PtyModule>;
    try {
      mod = (await import(name)) as typeof mod;
    } catch (error) {
      if (isMissing(error, name)) continue;
      throw new ShowcaseError(`${name} is installed but failed to load: ${(error as Error).message}\n\n${INSTALL_HINT}`);
    }
    const loaded = typeof mod.spawn === 'function' ? (mod as PtyModule) : mod.default;
    if (typeof loaded?.spawn !== 'function') throw new ShowcaseError(`${name} does not export spawn().`);
    if (candidates === PTY_PACKAGES) cached = loaded;
    return loaded;
  }
  throw new ShowcaseError(INSTALL_HINT);
}

/** Inherited variables that make apps think they run in CI or in another terminal. */
const STRIPPED = ['NO_COLOR', 'CI', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'WT_SESSION', 'COLUMNS', 'LINES'];

const DEFAULTS: Record<string, string> = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  FORCE_COLOR: '3',
  TZ: 'UTC',
  // Only POSIX runtimes read these; on Windows the app has to pin its own locale.
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
};

/**
 * The child's environment: the inherited one without CI and terminal hints, then the deterministic defaults,
 * then `extra`. Names compare case-insensitively on Windows, where `Path` and `PATH` are one variable.
 */
export function ttyEnv(
  extra: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const fold = (name: string): string => (platform === 'win32' ? name.toUpperCase() : name);
  const env = new Map<string, [name: string, value: string]>();
  for (const [name, value] of Object.entries(base)) if (value !== undefined) env.set(fold(name), [name, value]);
  for (const name of STRIPPED) env.delete(fold(name));
  for (const layer of [DEFAULTS, extra]) {
    for (const [name, value] of Object.entries(layer)) env.set(fold(name), [name, value]);
  }
  return Object.fromEntries(env.values());
}

/** `file` through PATH and PATHEXT, like cmd.exe would find it. Undefined when it is not there. */
function whichWindows(file: string, env: Record<string, string>): string | undefined {
  const get = (name: string): string | undefined =>
    Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
  const exts = extname(file) ? [''] : (get('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs = isAbsolute(file) || /[\\/]/.test(file) ? [''] : (get('PATH') ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = dir ? join(dir, file + ext) : file + ext;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return undefined;
}

/**
 * Quote one argument of a `.cmd` or `.bat` shim for its cmd.exe command line. Inside quotes cmd.exe still expands
 * `%VAR%` (a command line has no escape for it, `%%` included) and a `"` flips its quoting for the rest of the line,
 * so arguments with either are refused. The shim's `%*` hands the text on as is, and the program's own parser reads
 * a backslash before the closing quote as an escape, so trailing backslashes are doubled.
 */
function cmdQuote(arg: string): string {
  if (/["%\r\n]/.test(arg)) {
    throw new ShowcaseError(
      `Cannot pass ${JSON.stringify(arg)} through a .cmd or .bat shim: cmd.exe cannot take a " or % in an argument, ` +
        'nor a line break. Run the program the shim starts directly, or use a command string and quote it yourself.',
    );
  }
  return /^[\w\-./\\:@+]+$/.test(arg) ? arg : `"${arg.replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * The file and arguments to hand to the PTY. A string goes through the shell, like `target.start`. An array is
 * spawned directly; on Windows `.cmd` and `.bat` shims (`pnpm`, `npm`) cannot be, so they go through cmd.exe.
 */
export function ptyCommand(
  command: string | readonly string[],
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] | string } {
  const comspec = (): string => Object.entries(env).find(([key]) => key.toUpperCase() === 'COMSPEC')?.[1] ?? 'cmd.exe';
  if (typeof command === 'string') {
    // node-pty takes a string as a ready command line on Windows; `/s` makes cmd strip exactly the outer quotes.
    return platform === 'win32' ? { file: comspec(), args: `/d /s /c "${command}"` } : { file: '/bin/sh', args: ['-c', command] };
  }
  const [file = '', ...args] = command;
  if (!file) throw new ShowcaseError('The terminal command is empty.');
  if (platform !== 'win32') return { file, args };
  const found = whichWindows(file, env);
  if (found && /\.(cmd|bat)$/i.test(found)) {
    // `/v:off`: a `!` stays literal even where delayed expansion is turned on by default.
    return { file: comspec(), args: `/d /v:off /s /c "${[found, ...args].map(cmdQuote).join(' ')}"` };
  }
  return { file: found ?? file, args };
}

export interface SpawnPtyOptions {
  command: string | readonly string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

/** Start `command` in a pseudo terminal of a fixed size with the deterministic environment. */
export function spawnPty(pty: PtyModule, opts: SpawnPtyOptions): PtyProcess {
  if (!existsSync(opts.cwd) || !statSync(opts.cwd).isDirectory()) {
    throw new ShowcaseError(`The terminal working directory does not exist: ${opts.cwd}`);
  }
  const env = ttyEnv(opts.env);
  const { file, args } = ptyCommand(opts.command, env);
  try {
    return pty.spawn(file, args, { name: env.TERM ?? DEFAULTS.TERM ?? '', cols: opts.cols, rows: opts.rows, cwd: opts.cwd, env });
  } catch (error) {
    throw new ShowcaseError(`Could not start ${JSON.stringify(opts.command)} in a terminal: ${(error as Error).message}`);
  }
}

