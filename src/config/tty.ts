import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { TerminalOptions, TerminalTheme } from '../tty/types.js';
import type { ResolvedTtyShot, ResolvedTtyTarget, TtyNavFn, TtyTarget } from './types.js';
import {
  checkKeys,
  describe,
  isObj,
  num,
  oneOf,
  resolveShotList,
  str,
  textPattern,
  type Issues,
  type Obj,
} from './validate.js';

/** Top-level keys that only make sense in a browser page. */
export const WEB_ONLY_KEYS: Readonly<Record<string, string>> = {
  viewport:
    'not used in tty mode (the image size comes from target.cols, target.rows, terminal.font.size and terminal.padding)',
  colorScheme: 'not used in tty mode (set terminal.theme)',
  css: 'not used in tty mode',
};

/** Top-level keys that only make sense for a terminal. */
export const TTY_ONLY_KEYS: Readonly<Record<string, string>> = { terminal: 'only used in tty mode' };

/** Target keys of the url and cdp modes, and of tty mode, for "wrong mode" messages. */
export const WEB_TARGET_KEYS: Readonly<Record<string, string>> = {
  url: 'not used in tty mode (the kit runs target.command in a terminal)',
  start: 'not used in tty mode (target.command starts the app)',
  reuseExisting: 'not used in tty mode',
  cdpUrl: 'not used in tty mode',
  pageMatch: 'not used in tty mode',
};
export const TTY_TARGET_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  ['command', 'cols', 'rows', 'quitKey', 'inputDelayMs'].map(key => [key, 'only used in tty mode']),
);

export const TTY_SHOT_KEYS: Readonly<Record<string, string>> = {
  keys: 'only used in tty mode',
  restart: 'only used in tty mode',
};

export const TTY_TIMEOUT_KEYS: Readonly<Record<string, string>> = {
  readyMs: 'not used in tty mode (set target.readyTimeoutMs)',
  networkIdleMs: 'not used in tty mode',
};

const FONT_FILES = ['file', 'boldFile', 'italicFile', 'boldItalicFile', 'fallbackFile'] as const;
const FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'];

/** The renderer mixes and dims theme colors itself, so it takes `#rrggbb` only. */
function hexColor(issues: Issues, path: string, value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return value;
  issues.add(path, value === undefined ? 'is required' : `must be a #rrggbb color, got ${describe(value)}`);
  return '#000000';
}

function command(issues: Issues, value: unknown): ResolvedTtyTarget['command'] {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (
    Array.isArray(value) &&
    value.every(part => typeof part === 'string') &&
    typeof value[0] === 'string' &&
    value[0].trim() !== ''
  ) {
    return value as [string, ...string[]];
  }
  issues.add(
    'target.command',
    value === undefined
      ? 'is required'
      : `must be a command string or an array [file, ...args] of strings, got ${describe(value)}`,
  );
  return '';
}

function env(issues: Issues, value: unknown): TtyTarget['env'] {
  if (value === undefined || typeof value === 'function') return value as TtyTarget['env'];
  if (isObj(value) && Object.values(value).every(entry => typeof entry === 'string')) {
    return value as Record<string, string>;
  }
  issues.add('target.env', 'must be an object of string values, or a function ({ lang }) => ({ ... })');
  return undefined;
}

export function resolveTtyTarget(issues: Issues, value: Obj, rootDir: string): ResolvedTtyTarget {
  checkKeys(
    issues,
    'target',
    value,
    ['mode', 'command', 'cwd', 'env', 'cols', 'rows', 'quitKey', 'inputDelayMs', 'readyTimeoutMs'],
    WEB_TARGET_KEYS,
  );
  const cwd = str(issues, 'target.cwd', value.cwd);
  let quitKey: string | false = 'q';
  if (value.quitKey === false) quitKey = false;
  else if (value.quitKey !== undefined) quitKey = str(issues, 'target.quitKey', value.quitKey) ?? 'q';
  return {
    mode: 'tty',
    command: command(issues, value.command),
    cwd: cwd === undefined ? rootDir : isAbsolute(cwd) ? cwd : resolve(rootDir, cwd),
    env: env(issues, value.env),
    cols: num(issues, 'target.cols', value.cols, 120, { min: 10, max: 500, integer: true }),
    rows: num(issues, 'target.rows', value.rows, 32, { min: 5, max: 200, integer: true }),
    quitKey,
    inputDelayMs: num(issues, 'target.inputDelayMs', value.inputDelayMs, 300, { min: 0, integer: true }),
    readyTimeoutMs: num(issues, 'target.readyTimeoutMs', value.readyTimeoutMs, 30_000, { min: 1, integer: true }),
  };
}

function keys(issues: Issues, path: string, value: unknown): ResolvedTtyShot['keys'] {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value !== '') return value;
  if (Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string' && part !== '')) {
    return value as string[];
  }
  issues.add(path, `must be a non-empty string or array of strings, such as '{Tab}' or ['j', 'j', '{Enter}'], got ${describe(value)}`);
  return undefined;
}

export function resolveTtyShots(issues: Issues, value: unknown, name: string): ResolvedTtyShot[] {
  return resolveShotList(issues, value, {
    name,
    allowed: ['keys', 'nav', 'restart'],
    elsewhere: {},
    extra: (entry, path) => {
      let nav: TtyNavFn | undefined;
      if (typeof entry.nav === 'function') {
        nav = entry.nav as TtyNavFn;
        if (entry.keys !== undefined) {
          issues.add(`${path}.nav`, 'cannot be combined with keys: press the keys inside nav instead');
        }
      } else if (entry.nav !== undefined) {
        issues.add(
          `${path}.nav`,
          `must be a function of the terminal session in tty mode (async tty => { ... }); use keys: '{Tab}' to press keys, got ${describe(entry.nav)}`,
        );
      }
      let restart = false;
      if (entry.restart !== undefined) {
        if (typeof entry.restart === 'boolean') restart = entry.restart;
        else issues.add(`${path}.restart`, `must be true or false, got ${describe(entry.restart)}`);
      }
      return {
        keys: keys(issues, `${path}.keys`, entry.keys),
        nav,
        waitFor: textPattern(issues, `${path}.waitFor`, entry.waitFor),
        restart,
      };
    },
  });
}

function theme(issues: Issues, value: unknown): TerminalOptions['theme'] {
  if (value === undefined || value === 'dark' || value === 'light') return value;
  if (!isObj(value)) {
    issues.add('terminal.theme', `must be "dark", "light" or { background, foreground, cursor?, ansi }, got ${describe(value)}`);
    return undefined;
  }
  checkKeys(issues, 'terminal.theme', value, ['background', 'foreground', 'cursor', 'ansi']);
  const custom: TerminalTheme = {
    background: hexColor(issues, 'terminal.theme.background', value.background),
    foreground: hexColor(issues, 'terminal.theme.foreground', value.foreground),
    ansi: [],
  };
  if (value.cursor !== undefined) custom.cursor = hexColor(issues, 'terminal.theme.cursor', value.cursor);
  if (Array.isArray(value.ansi) && value.ansi.length === 16) {
    custom.ansi = value.ansi.map((entry: unknown, index) =>
      hexColor(issues, `terminal.theme.ansi[${String(index)}]`, entry),
    );
  } else {
    issues.add(
      'terminal.theme.ansi',
      `must be an array of exactly 16 #rrggbb colors (8 normal, then 8 bright), got ${describe(value.ansi)}`,
    );
  }
  return custom;
}

function font(issues: Issues, value: unknown, rootDir: string): TerminalOptions['font'] {
  if (value === undefined) return undefined;
  if (!isObj(value)) {
    issues.add('terminal.font', `must be an object, got ${describe(value)}`);
    return undefined;
  }
  checkKeys(issues, 'terminal.font', value, [...FONT_FILES, 'size']);
  const result: NonNullable<TerminalOptions['font']> = {};
  for (const key of FONT_FILES) {
    const path = `terminal.font.${key}`;
    const file = str(issues, path, value[key]);
    if (file === undefined) continue;
    if (!FONT_EXTENSIONS.some(extension => file.toLowerCase().endsWith(extension))) {
      issues.add(path, `must be a ${FONT_EXTENSIONS.join(', ')} file, got "${file}"`);
    } else if (!existsSync(resolve(rootDir, file))) {
      issues.add(path, `file not found: ${resolve(rootDir, file)}`);
    }
    result[key] = file;
  }
  if (value.size !== undefined) result.size = num(issues, 'terminal.font.size', value.size, 15, { min: 6, max: 96 });
  return result;
}

/** Check the terminal look. Paths stay as written; `resolveTerminalOptions` makes them absolute. */
export function checkTerminal(issues: Issues, value: unknown, rootDir: string): TerminalOptions | undefined {
  if (value === undefined) return undefined;
  if (!isObj(value)) {
    issues.add('terminal', `must be an object, got ${describe(value)}`);
    return undefined;
  }
  checkKeys(issues, 'terminal', value, ['theme', 'font', 'lineHeight', 'padding', 'cursor']);
  const options: TerminalOptions = {};
  const look = theme(issues, value.theme);
  if (look !== undefined) options.theme = look;
  const fonts = font(issues, value.font, rootDir);
  if (fonts !== undefined) options.font = fonts;
  if (value.lineHeight !== undefined) {
    options.lineHeight = num(issues, 'terminal.lineHeight', value.lineHeight, 1.32, { min: 1, max: 3 });
  }
  if (value.padding !== undefined) {
    options.padding = num(issues, 'terminal.padding', value.padding, 12, { min: 0, max: 400, integer: true });
  }
  if (value.cursor !== undefined) {
    options.cursor = oneOf(issues, 'terminal.cursor', value.cursor, ['hide', 'show'] as const, 'hide');
  }
  return options;
}
